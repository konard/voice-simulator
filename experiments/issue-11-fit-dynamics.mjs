/**
 * Fit of the articulator dynamics to the golden recordings (issue 38, P26
 * of issue 11). For every recording of tests/fixtures/golden:
 *
 * 1. render its IPA once (tier minimal) and align the audio with the
 *    recording (experiments/issue-11-align.mjs) to measure the duration of
 *    every token;
 * 2. render again with these durations (`planUtterance(..., {durations})`),
 *    shifted so that the first sound starts where it does in the recording,
 *    and score the mean F1 to F3 error in percent of `formantErrors()`
 *    (voiced frames only).
 *
 * The parameters are the time constant and the lead of the eight
 * articulation channels with the largest effect on that error (each changed
 * by 20 % first) and the four levels of COARTICULATION_RESISTANCE. Method:
 * coordinate descent with steps of ±15 %, then ±5 % (time constants and
 * leads relative, resistance levels in absolute steps of 0.15 and 0.05),
 * inside the limits of ARTICULATORS, at most 6 rounds. Every fifth
 * recording of a language is held out and scored separately. The fitted
 * values should replace ARTICULATORS and COARTICULATION_RESISTANCE only if
 * the held-out error falls by at least 5 %.
 *
 * After the fit it checks whether the reduced vowels still need their
 * duration factor 0.75 and their own shapes (issue 38, step 5).
 *
 *   node experiments/issue-11-fit-dynamics.mjs [--limit <n per language>]
 *     [--workers <n>] [--rounds <n>] [--out <file.txt>]
 *
 * Writes experiments/issue-11-fit-dynamics.txt (and .json) by default. The
 * heavy test tests/heavy/quality-dynamics-fit.test.js runs it with
 * `npm run test:heavy -- --suite quality`.
 */

import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';

import {
  ARTICULATORS,
  COARTICULATION_RESISTANCE,
  getAudioTier,
  getPhoneme,
  planUtterance,
  presetHeadConfig,
  renderPlan,
} from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { formantErrors, formantTrack } from '../src/metrics/formants.js';
import { pitchTrack } from '../src/metrics/pitch.js';
import { loadGolden } from '../tests/helpers/golden.js';
import { alignToRecording } from './issue-11-align.mjs';

/** Rate of the recordings, of the analysis and of the rendered audio. */
const SAMPLE_RATE = 16000;
const HOP = 0.01;
const TIER = 'minimal';
/** Every HOLD_OUT-th recording of a language is held out. */
const HOLD_OUT = 5;
const SCREEN_STEP = 0.2;
const STEPS = [0.15, 0.05];
const MAX_ROUNDS = 6;
const FREE_CHANNELS = 8;
const ACCEPT_GAIN = 0.05;
/** Median f0 below which a recording gets the male preset head. */
const MALE_F0 = 165;
const REDUCED = new Set(['ə', 'ɐ', 'ɪ', 'ʊ', 'ɨ', 'ɚ']);
/** Full vowel used in place of each reduced vowel for the shape check. */
const FULL_VOWEL = { ə: 'ʌ', ɐ: 'a', ɪ: 'i', ʊ: 'u', ɨ: 'i', ɚ: 'ɝ' };
const LEVELS = Object.keys(COARTICULATION_RESISTANCE.levels);

// ---------------------------------------------------------------- worker

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function render(plan) {
  const tier = getAudioTier(TIER);
  const samples = renderPlan(plan, {
    solver: tier.solver,
    sections: tier.sections,
    sampleRate: tier.sampleRate,
    head: plan.head,
    seed: 1,
  });
  return resample(samples, tier.sampleRate, SAMPLE_RATE);
}

/** Shift audio `offset` seconds later (earlier when negative). */
function shift(samples, offset) {
  const count = Math.round(offset * SAMPLE_RATE);
  if (count >= 0) {
    const out = new Float32Array(samples.length + count);
    out.set(samples, count);
    return out;
  }
  return samples.subarray(Math.min(-count, samples.length));
}

/** A token whose vowel is replaced by its full counterpart. */
function fullVowel(token) {
  const base = FULL_VOWEL[token.base];
  return base
    ? { ...token, base, symbol: base, phoneme: getPhoneme(base) }
    : token;
}

function prepareItem(item) {
  const pitch = pitchTrack(item.samples, item.sampleRate, { hop: HOP });
  const f0 = median(Array.from(pitch).filter((value) => value > 0));
  const sex = f0 > 0 && f0 < MALE_F0 ? 'male' : 'female';
  const head = presetHeadConfig(sex);
  const plan = planUtterance(item.ipa, { head, language: item.lang });
  const aligned = alignToRecording(
    plan,
    { samples: render(plan), sampleRate: SAMPLE_RATE },
    item
  );
  const reference = formantTrack(item.samples, item.sampleRate, {
    hop: HOP,
    pitch,
  });
  // Frames inside reduced vowels, from the aligned boundaries.
  const reducedFrames = new Uint8Array(reference.length);
  const tokenIndex = new Map(plan.tokens.map((token, index) => [token, index]));
  const vowels = [];
  plan.segments.forEach((segment, index) => {
    if (segment.kind !== 'vowel') {
      return;
    }
    const reduced = REDUCED.has(segment.token.base);
    const start = aligned.boundaries[index];
    const end = aligned.boundaries[index + 1];
    vowels.push({
      reduced,
      stressed: Boolean(segment.token.stress),
      planned: segment.end - segment.start,
      measured: end - start,
      token: tokenIndex.get(segment.token),
    });
    if (reduced) {
      for (
        let frame = Math.ceil(start / HOP);
        frame < Math.min(reference.length, end / HOP);
        frame++
      ) {
        reducedFrames[frame] = 1;
      }
    }
  });
  return {
    id: item.id,
    lang: item.lang,
    sex,
    f0,
    head,
    tokens: plan.tokens,
    durations: aligned.durations,
    offset: aligned.offset,
    cost: aligned.cost,
    reference,
    reducedFrames,
    vowels,
  };
}

function masked(track, mask) {
  return mask
    ? track.map((frame, index) => (mask[index] ? frame : null))
    : track;
}

function evaluateItem(item, job) {
  const tokens =
    job.variant === 'full-vowels' ? item.tokens.map(fullVowel) : item.tokens;
  const plan = planUtterance(tokens, {
    head: item.head,
    language: item.lang,
    durations: item.durations,
    articulators: job.params.articulators,
    resistance: job.params.resistance,
  });
  const samples = shift(render(plan), item.offset);
  const test = formantTrack(samples, SAMPLE_RATE, { hop: HOP });
  const mask = job.mask === 'reduced' ? item.reducedFrames : null;
  const errors = formantErrors(
    masked(item.reference, mask),
    masked(test, mask)
  );
  return {
    id: item.id,
    frames: errors.frames,
    f1: errors.f1.percent,
    f2: errors.f2.percent,
    f3: errors.f3.percent,
  };
}

function runWorker() {
  const items = loadGolden()
    .filter((item) => workerData.ids.includes(item.id))
    .map(prepareItem);
  parentPort.postMessage({
    ready: items.map(({ id, lang, sex, f0, offset, cost, vowels }) => ({
      id,
      lang,
      sex,
      f0,
      offset,
      cost,
      vowels,
    })),
  });
  parentPort.on('message', (job) => {
    parentPort.postMessage({
      job: job.id,
      results: items.map((item) => evaluateItem(item, job)),
    });
  });
}

// ------------------------------------------------------------------ main

/** Flat parameter set of the fit from ARTICULATORS and the levels. */
function initialParameters() {
  const values = {};
  for (const [name, entry] of Object.entries(ARTICULATORS)) {
    values[`${name}.timeConstant`] = entry.timeConstant;
    values[`${name}.lead`] = entry.lead;
  }
  for (const level of LEVELS) {
    values[`resistance.${level}`] = COARTICULATION_RESISTANCE.levels[level];
  }
  return values;
}

function toOptions(values) {
  const articulators = {};
  const resistance = {};
  for (const [key, value] of Object.entries(values)) {
    const [name, field] = key.split('.');
    if (name === 'resistance') {
      resistance[field] = value;
    } else {
      articulators[name] = { ...articulators[name], [field]: value };
    }
  }
  return { articulators, resistance };
}

/** The parameter `key` moved by `step` (+ or -), inside its limits. */
function moved(values, key, step) {
  const [name, field] = key.split('.');
  const value = values[key];
  if (name === 'resistance') {
    return Math.min(1, Math.max(0, value + step));
  }
  const entry = ARTICULATORS[name];
  const [low, high] =
    field === 'lead' ? [entry.leadMin, entry.leadMax] : [entry.min, entry.max];
  return Math.min(high, Math.max(low, value * (1 + step)));
}

const round = (value, digits = 4) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits));

function meanError(result) {
  const parts = [result.f1, result.f2, result.f3].filter(
    (value) => value !== null
  );
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** Mean error per formant and in total over some recordings. */
function summary(results, ids) {
  const picked = ids.map((id) => results.get(id)).filter((r) => r?.frames);
  const mean = (key) => {
    const values = picked.map(key).filter((value) => value !== null);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };
  return {
    recordings: picked.length,
    frames: picked.reduce((sum, r) => sum + r.frames, 0),
    f1: mean((r) => r.f1),
    f2: mean((r) => r.f2),
    f3: mean((r) => r.f3),
    mean: mean(meanError),
  };
}

class Pool {
  constructor(groups) {
    this.jobs = 0;
    this.workers = groups.map(
      (ids) => new Worker(new URL(import.meta.url), { workerData: { ids } })
    );
  }

  async ready() {
    const parts = await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.once('error', reject);
            worker.once('message', (message) => resolve(message.ready));
          })
      )
    );
    return parts.flat();
  }

  /** Results of every recording for one parameter set, by id. */
  async evaluate(values, extra = {}) {
    const id = ++this.jobs;
    const job = { id, params: toOptions(values), ...extra };
    const parts = await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            const onMessage = (message) => {
              if (message.job === id) {
                worker.off('message', onMessage);
                worker.off('error', reject);
                resolve(message.results);
              }
            };
            worker.on('message', onMessage);
            worker.once('error', reject);
            worker.postMessage(job);
          })
      )
    );
    return new Map(parts.flat().map((result) => [result.id, result]));
  }

  close() {
    return Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

/** Split items over `count` workers with about the same audio length. */
function groupsOf(items, count) {
  const groups = Array.from({ length: count }, () => ({ ids: [], load: 0 }));
  const sorted = [...items].sort((a, b) => b.samples.length - a.samples.length);
  for (const item of sorted) {
    const group = groups.reduce((a, b) => (b.load < a.load ? b : a));
    group.ids.push(item.id);
    group.load += item.samples.length;
  }
  return groups.filter((group) => group.ids.length).map((group) => group.ids);
}

function selectItems(limit) {
  const counts = {};
  return loadGolden().filter((item) => {
    counts[item.lang] = (counts[item.lang] ?? 0) + 1;
    return counts[item.lang] <= limit;
  });
}

/** Reduced against full vowels in the measured and the planned durations. */
function durationCheck(prepared) {
  const rows = [];
  for (const lang of [...new Set(prepared.map((item) => item.lang))]) {
    const vowels = prepared
      .filter((item) => item.lang === lang)
      .flatMap((item) => item.vowels)
      .filter((vowel) => !vowel.stressed);
    const reduced = vowels.filter((vowel) => vowel.reduced);
    const full = vowels.filter((vowel) => !vowel.reduced);
    const mean = (list, key) =>
      list.length
        ? list.reduce((sum, v) => sum + v[key], 0) / list.length
        : null;
    const ratio = (key) =>
      reduced.length && full.length
        ? mean(reduced, key) / mean(full, key)
        : null;
    rows.push({
      lang,
      reduced: reduced.length,
      full: full.length,
      planned: round(ratio('planned'), 3),
      measured: round(ratio('measured'), 3),
    });
  }
  return rows;
}

const pct = (value) =>
  value === null ? '   -  ' : value.toFixed(2).padStart(6);

function errorTable(title, rows) {
  const lines = [
    title,
    'set        lang  rec  frames    F1 %    F2 %    F3 %  mean %',
  ];
  for (const row of rows) {
    lines.push(
      [
        row.set.padEnd(9),
        row.lang.padEnd(5),
        String(row.recordings).padStart(4),
        String(row.frames).padStart(7),
        pct(row.f1),
        pct(row.f2),
        pct(row.f3),
        pct(row.mean),
      ].join(' ')
    );
  }
  return lines.join('\n');
}

function breakdown(results, sets, languages) {
  const rows = [];
  for (const [set, ids] of Object.entries(sets)) {
    for (const lang of ['all', ...languages]) {
      const picked = ids.filter(
        (id) => lang === 'all' || id.startsWith(`${lang}-`)
      );
      rows.push({ set, lang, ...summary(results, picked) });
    }
  }
  return rows;
}

/** Training and held-out ids: every HOLD_OUT-th recording of a language. */
function splitHoldOut(items) {
  const train = [];
  const held = [];
  const position = {};
  for (const item of items) {
    position[item.lang] = (position[item.lang] ?? 0) + 1;
    (position[item.lang] % HOLD_OUT === 0 ? held : train).push(item.id);
  }
  return { train, held };
}

/** Effect of every channel: its time constant and its lead by ±20 %. */
async function screenChannels(score, start, before, log) {
  const effects = [];
  for (const name of Object.keys(ARTICULATORS)) {
    let effect = 0;
    for (const field of ['timeConstant', 'lead']) {
      for (const sign of [1, -1]) {
        const key = `${name}.${field}`;
        const values = {
          ...start,
          [key]: start[key] * (1 + sign * SCREEN_STEP),
        };
        const { error } = await score(values);
        effect = Math.max(effect, Math.abs(error - before));
      }
    }
    effects.push({ name, effect: round(effect) });
    log(`effect of ${name} ${effect.toFixed(4)} %`);
  }
  return effects.sort((a, b) => b.effect - a.effect);
}

/** Coordinate descent over `keys`, first move that lowers the error wins. */
async function descend(score, start, keys, before, maxRounds, log) {
  let values = { ...start };
  let best = before;
  const rounds = [];
  let stepIndex = 0;
  for (let r = 0; r < maxRounds && stepIndex < STEPS.length; r++) {
    const step = STEPS[stepIndex];
    let improved = false;
    for (const key of keys) {
      for (const sign of [1, -1]) {
        const value = moved(values, key, sign * step);
        if (value === values[key]) {
          continue;
        }
        const candidate = { ...values, [key]: value };
        const { error } = await score(candidate);
        if (error < best - 1e-6) {
          best = error;
          values = candidate;
          improved = true;
          break;
        }
      }
    }
    rounds.push({ round: r + 1, step, error: round(best) });
    log(`round ${r + 1} (±${step * 100} %): ${best.toFixed(3)} %`);
    if (!improved) {
      stepIndex++;
    }
  }
  return { values, rounds };
}

/** Held-out error before and after, and the relative gain. */
function heldOutGain(beforeResults, afterResults, held) {
  const before = summary(beforeResults, held).mean;
  const after = summary(afterResults, held).mean;
  const gain = before && after !== null ? (before - after) / before : null;
  return {
    before,
    after,
    gain,
    accepted: gain !== null && gain >= ACCEPT_GAIN,
  };
}

/** Step 5: reduced vowels, with the values that are kept. */
async function reductionCheck(pool, values, items, prepared) {
  const own = await pool.evaluate(values, { mask: 'reduced' });
  const full = await pool.evaluate(values, {
    mask: 'reduced',
    variant: 'full-vowels',
  });
  const all = items.map((item) => item.id);
  return {
    shapes: { own: summary(own, all), full: summary(full, all) },
    durations: durationCheck(prepared),
  };
}

function recordingRows(prepared, held) {
  return prepared.map(({ vowels, ...rest }) => ({
    ...rest,
    f0: round(rest.f0, 1),
    offset: round(rest.offset, 3),
    cost: round(rest.cost, 2),
    vowels: vowels.length,
    heldOut: held.includes(rest.id),
  }));
}

/**
 * Run the fit.
 * @param {{limit?: number, workers?: number, rounds?: number, log?: (line: string) => void}} [options]
 * @returns {Promise<{text: string, data: object}>}
 */
export async function fitDynamics(options = {}) {
  const started = Date.now();
  const print = options.log ?? ((line) => console.error(line));
  const log = (line) =>
    print(`${((Date.now() - started) / 1000).toFixed(0)} s: ${line}`);
  const items = selectItems(options.limit ?? Infinity);
  const languages = [...new Set(items.map((item) => item.lang))];
  const { train, held } = splitHoldOut(items);
  const workerCount = Math.max(
    1,
    Math.min(options.workers ?? availableParallelism() - 1, items.length)
  );
  const pool = new Pool(groupsOf(items, workerCount));
  try {
    const prepared = await pool.ready();
    log(`${items.length} recordings aligned, ${workerCount} workers`);
    const start = initialParameters();
    let evaluations = 0;
    const score = async (values) => {
      evaluations++;
      const results = await pool.evaluate(values);
      return { results, error: summary(results, train).mean };
    };
    const before = await score(start);
    log(`train error before ${before.error.toFixed(3)} %`);
    const effects = await screenChannels(score, start, before.error, log);
    const channels = effects.slice(0, FREE_CHANNELS).map((entry) => entry.name);
    const keys = [
      ...channels.flatMap((name) => [`${name}.timeConstant`, `${name}.lead`]),
      ...LEVELS.map((level) => `resistance.${level}`),
    ];
    const maxRounds = Math.min(options.rounds ?? MAX_ROUNDS, MAX_ROUNDS);
    const { values, rounds } = await descend(
      score,
      start,
      keys,
      before.error,
      maxRounds,
      log
    );
    const after = await pool.evaluate(values);
    const heldOut = heldOutGain(before.results, after, held);
    const reduction = await reductionCheck(
      pool,
      heldOut.accepted ? values : start,
      items,
      prepared
    );
    log(`done after ${evaluations} evaluations`);
    const data = {
      settings: {
        tier: TIER,
        sampleRate: SAMPLE_RATE,
        holdOut: HOLD_OUT,
        screenStep: SCREEN_STEP,
        steps: STEPS,
        maxRounds,
        limit: options.limit ?? null,
        workers: workerCount,
        evaluations,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      recordings: recordingRows(prepared, held),
      effects,
      channels,
      rounds,
      before: breakdown(before.results, { train, held }, languages),
      after: breakdown(after, { train, held }, languages),
      held: {
        before: round(heldOut.before),
        after: round(heldOut.after),
        gain: round(heldOut.gain),
      },
      accepted: heldOut.accepted,
      start: Object.fromEntries(keys.map((key) => [key, round(start[key])])),
      fitted: Object.fromEntries(keys.map((key) => [key, round(values[key])])),
      reduction,
    };
    return { text: renderText(data), data };
  } finally {
    await pool.close();
  }
}

function renderText(data) {
  const { settings } = data;
  const lines = [
    'Fit of the articulator dynamics to the golden recordings (issue 38).',
    'Run: node experiments/issue-11-fit-dynamics.mjs',
    '',
    `Tier ${settings.tier}, analysis at ${settings.sampleRate} Hz; error = mean of the F1, F2 and F3`,
    'errors in percent of formantErrors() over the voiced frames of both signals,',
    `averaged over the recordings. Held out: every ${settings.holdOut}th recording of a language.`,
    `${settings.evaluations} evaluations on ${settings.workers} workers in ${settings.seconds} s.`,
    '',
    'Recordings (head preset from the median f0; offset = start of the first',
    'sound in the recording minus in the plan, s; DTW cost in dB per frame):',
  ];
  for (const r of data.recordings) {
    lines.push(
      `  ${r.id.padEnd(6)} ${r.heldOut ? 'held ' : 'train'} ${r.sex.padEnd(6)} f0 ${String(r.f0).padStart(5)}  offset ${r.offset.toFixed(3).padStart(6)}  cost ${r.cost.toFixed(2)}`
    );
  }
  lines.push(
    '',
    'Effect of each channel (largest change of the train error, percentage',
    `points, with its time constant or lead changed by ±${settings.screenStep * 100} %):`
  );
  for (const entry of data.effects) {
    const free = data.channels.includes(entry.name) ? ' (fitted)' : '';
    lines.push(`  ${entry.name.padEnd(15)} ${entry.effect.toFixed(4)}${free}`);
  }
  lines.push('', 'Coordinate descent (train error, %):');
  for (const entry of data.rounds) {
    lines.push(
      `  round ${entry.round}  step ±${entry.step * 100} %  ${entry.error.toFixed(3)}`
    );
  }
  lines.push(
    '',
    errorTable('Before the fit:', data.before),
    '',
    errorTable('After the fit:', data.after),
    '',
    data.held.gain === null
      ? 'Held-out error: no recording held out.'
      : `Held-out error: ${data.held.before.toFixed(3)} % before, ${data.held.after.toFixed(3)} % after (${(data.held.gain * 100).toFixed(1)} % lower).`,
    data.accepted
      ? 'ACCEPTED: the held-out error falls by at least 5 %; the fitted values go into ARTICULATORS and COARTICULATION_RESISTANCE.'
      : 'REJECTED: the held-out error falls by less than 5 %; ARTICULATORS and COARTICULATION_RESISTANCE keep their starting values.',
    '',
    'Values (start -> fitted):'
  );
  for (const [key, value] of Object.entries(data.fitted)) {
    lines.push(
      `  ${key.padEnd(28)} ${String(data.start[key]).padStart(7)} -> ${value}`
    );
  }
  const { shapes, durations } = data.reduction;
  lines.push(
    '',
    'Reduced vowels (step 5), with the values that are kept:',
    `  formant error inside reduced vowels, own shapes:  ${pct(shapes.own.mean)} % (${shapes.own.frames} frames)`,
    `  same frames with the full vowels ${Object.entries(FULL_VOWEL)
      .map(([a, b]) => `${a}->${b}`)
      .join(' ')}: ${pct(shapes.full.mean)} %`,
    '  duration of unstressed reduced / unstressed full vowels (plan has the factor 0.75):',
    '  lang  reduced  full  planned  measured'
  );
  for (const row of durations) {
    lines.push(
      `  ${row.lang.padEnd(5)} ${String(row.reduced).padStart(7)} ${String(row.full).padStart(5)} ${String(row.planned ?? '-').padStart(8)} ${String(row.measured ?? '-').padStart(9)}`
    );
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--limit') {
      options.limit = Number(value);
    } else if (flag === '--workers') {
      options.workers = Number(value);
    } else if (flag === '--rounds') {
      options.rounds = Number(value);
    } else if (flag === '--out') {
      options.out = value;
    } else {
      throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}

if (!isMainThread) {
  runWorker();
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArgs(process.argv.slice(2));
  const out =
    options.out ??
    fileURLToPath(new URL('./issue-11-fit-dynamics.txt', import.meta.url));
  const { text, data } = await fitDynamics(options);
  writeFileSync(out, text);
  writeFileSync(
    out.replace(/\.txt$/, '.json'),
    `${JSON.stringify(data, null, 2)}\n`
  );
  process.stdout.write(text);
}
