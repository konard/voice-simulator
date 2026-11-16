#!/usr/bin/env node

/**
 * Listening tests (issue 20): prepare the sounds of a blind test, analyse the
 * answers and write semantically unpredictable sentences.
 *
 * The test itself runs in examples/listening-test/index.html, opened from
 * disk. `build` renders every sentence with the simulator, adds the
 * reference and the two low-pass anchors of ITU-R BS.1534-3 (MUSHRA) and
 * writes the sound files and config.js. `analyze` reads the result files
 * that the listeners send back and prints a Markdown report. Choice trials
 * (issue 55) play one sentence in one emotion and ask which emotion it was.
 * `sus` prints
 * English semantically unpredictable sentences (Benoît et al. 1996) for the
 * intelligibility trials.
 *
 * Usage:
 *   node scripts/listening-test.mjs build --sentences <file.json>
 *                                         [--out examples/listening-test]
 *   node scripts/listening-test.mjs analyze <result.json>... [--json]
 *                                  [--out report.md] [--config <config.js>]
 *   node scripts/listening-test.mjs sus [--lang en] [--count 20] [--seed 1]
 *
 * Exit codes: 0 ok, 2 wrong usage or unreadable input.
 *
 * See examples/listening-test/README.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeAudio } from '../src/audio/formats.js';
import { resample } from '../src/audio/resample.js';
import { encodeWav } from '../src/audio/wav.js';
import { errorRate } from '../src/metrics/text.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';
import { EMOTIONS } from '../src/articulation/emotion.js';
import { createRandom } from '../src/random.js';
import { synthesize } from '../src/synthesize.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const TEST_DIR = path.join(REPO_ROOT, 'examples', 'listening-test');
export const DEFAULT_CONFIG = path.join(TEST_DIR, 'config.js');
export const SUS_FILE = (lang) => path.join(TEST_DIR, `sus.${lang}.json`);

/** Every stimulus: 16-bit mono WAV at 48000 Hz with an RMS of -26 dBFS. */
export const STIMULUS = Object.freeze({
  sampleRate: 48000,
  bitDepth: 16,
  rmsDbfs: -26,
});
/** Low-pass anchors: the reference resampled to `rate` and back. */
export const ANCHORS = Object.freeze({ anchor35: 7000, anchor70: 14000 });
export const MAX_CONDITIONS = 12;
/** Post-screening of BS.1534-3: hidden reference below 90 in > 15 %. */
export const SCREENING = Object.freeze({ below: 90, share: 0.15 });
export const Z95 = 1.959964;
/** Headroom (dB) of every choice sound, as in tests/emotion.test.js. */
const CHOICE_HEADROOM = 20;
/** Highest peak of a choice sound after the shared gain. */
const CHOICE_PEAK = 0.98;
/** Fewest listeners whose results may back a claim (see README.md). */
export const MIN_LISTENERS = 8;
export const VOLUME_SECONDS = 2;

const TYPES = ['mushra', 'abx', 'intelligibility', 'choice'];
/** The tier of a choice sentence when it gives none. */
const CHOICE_TIER = 'medium';
const RESERVED = ['reference', ...Object.keys(ANCHORS)];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const EXIT = { ok: 0, usage: 2 };

export const USAGE = `Usage:
  node scripts/listening-test.mjs build --sentences <file.json> [--out <folder>]
      Render the sentences and write <folder>/stimuli/ and <folder>/config.js
      (default folder: examples/listening-test).
  node scripts/listening-test.mjs analyze <result.json>... [--json]
      [--out <report.md>] [--config <config.js>]
      Print a Markdown report (or JSON) of the downloaded result files. The
      intelligibility and choice trials need the config.js of the test
      (default examples/listening-test/config.js).
  node scripts/listening-test.mjs sus [--lang en] [--count 20] [--seed 1]
      Print semantically unpredictable sentences (English only).`;

class UsageError extends Error {}

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

// ---------------------------------------------------------------------------
// Signal

/** RMS level in dBFS (full scale 1.0, so a full-scale square is 0 dBFS). */
export function rmsDbfs(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return 20 * Math.log10(Math.max(rms, 1e-10));
}

/**
 * Scale a signal to an RMS of `dbfs`.
 * @param {ArrayLike<number>} samples
 * @param {number} [dbfs]
 * @returns {Float32Array}
 */
export function scaleToRms(samples, dbfs = STIMULUS.rmsDbfs) {
  const level = rmsDbfs(samples);
  if (level <= -200) {
    throw new Error('cannot scale a silent signal');
  }
  const gain = 10 ** ((dbfs - level) / 20);
  return Float32Array.from(samples, (value) => value * gain);
}

/**
 * Low-pass anchor of BS.1534-3: resample to `rate` and back, so nothing
 * above about rate / 2 is left.
 */
export function lowPassAnchor(samples, sampleRate, rate) {
  return resample(resample(samples, sampleRate, rate), rate, sampleRate);
}

/**
 * Pink noise for the volume check: white noise from createRandom(seed)
 * through Paul Kellet's three-pole "economy" filter (1/f within about
 * ±0.5 dB above 40 Hz), with 50 ms linear fades.
 */
export function pinkNoise(seconds, sampleRate, seed = 1) {
  const random = createRandom(seed);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    samples[i] = b0 + b1 + b2 + white * 0.1848;
  }
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < fade && i < samples.length / 2; i++) {
    samples[i] *= i / fade;
    samples[samples.length - 1 - i] *= i / fade;
  }
  return samples;
}

// ---------------------------------------------------------------------------
// build

const tierIndex = (name) => AUDIO_TIERS.findIndex((t) => t.name === name);

function soundProblems(entry) {
  const problems = [];
  const tiers = entry.tiers ?? [];
  if (!Array.isArray(tiers)) {
    return ['tiers must be a list'];
  }
  for (const tier of tiers) {
    if (tierIndex(tier) < 0) {
      problems.push(`unknown tier "${tier}"`);
    }
  }
  if (entry.reference !== undefined && !isText(entry.reference)) {
    problems.push('reference must be a file name');
  }
  for (const [extra, file] of Object.entries(entry.extra ?? {})) {
    const taken = RESERVED.includes(extra) || tiers.includes(extra);
    if (!NAME.test(extra) || taken) {
      problems.push(`extra "${extra}" is not a free condition name`);
    }
    if (!isText(file)) {
      problems.push(`extra "${extra}" needs a file name`);
    }
  }
  return problems;
}

function entryProblems(entry, index, seen) {
  const name = `sentence ${index + 1}${isText(entry?.id) ? ` (${entry.id})` : ''}`;
  if (!isObject(entry)) {
    return [`${name}: not an object`];
  }
  const problems = [];
  if (!NAME.test(entry.id ?? '')) {
    problems.push(`id must match ${NAME.source}`);
  } else if (seen.has(entry.id)) {
    problems.push('duplicate id');
  }
  seen.add(entry.id);
  if (!isText(entry.text)) {
    problems.push('missing text');
  }
  if (entry.type !== undefined && !TYPES.includes(entry.type)) {
    problems.push(`unknown type "${entry.type}"`);
  }
  problems.push(...soundProblems(entry));
  if (entry.type === 'choice') {
    problems.push(...choiceProblems(entry));
  }
  return problems.map((problem) => `${name}: ${problem}`);
}

const isEmotion = (name) => Object.hasOwn(EMOTIONS, name);

/**
 * A choice sentence: `emotions` (the sounds, each a preset of
 * src/articulation/emotion.js), `intensity` (0..1, default 1), `choices`
 * (the answers offered, default the emotions) and at most one tier.
 */
function choiceProblems(entry) {
  const { emotions, choices = emotions, intensity = 1 } = entry;
  if (!Array.isArray(emotions) || emotions.length === 0) {
    return ['a choice sentence needs a list of emotions'];
  }
  const problems = emotions
    .filter((emotion) => !isEmotion(emotion))
    .map((emotion) => `unknown emotion "${emotion}"`);
  if (new Set(emotions).size !== emotions.length) {
    problems.push('duplicate emotion');
  }
  if (!Array.isArray(choices) || choices.length < 2) {
    problems.push('choices must be a list of at least two answers');
  } else {
    problems.push(
      ...emotions
        .filter((emotion) => !choices.includes(emotion))
        .map((emotion) => `emotion "${emotion}" is not among the choices`)
    );
  }
  const unit = typeof intensity === 'number' && intensity >= 0;
  if (!(unit && intensity <= 1)) {
    problems.push('intensity must be a number from 0 to 1');
  }
  if ((entry.tiers ?? []).length > 1) {
    problems.push('a choice sentence has at most one tier');
  }
  if (entry.reference !== undefined || entry.extra !== undefined) {
    problems.push('a choice sentence has no reference and no extra files');
  }
  return problems;
}

/**
 * Read a sentences file: either a list of entries or
 * `{id, title, instructions, sentences: [...]}`.
 * @param {string} file
 */
export function readSentences(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const study = Array.isArray(parsed) ? { sentences: parsed } : parsed;
  if (!isObject(study) || !Array.isArray(study.sentences)) {
    throw new UsageError(`${file}: expected a list of sentences`);
  }
  return {
    id: study.id ?? path.basename(file).replace(/\.json$/u, ''),
    title: study.title,
    instructions: study.instructions,
    sentences: study.sentences,
    dir: path.dirname(path.resolve(file)),
  };
}

function readRecording(file) {
  const decoded = decodeAudio(readFileSync(file));
  return resample(decoded.samples, decoded.sampleRate, STIMULUS.sampleRate);
}

function render(entry, tier, emotion) {
  const text = emotion
    ? `[${emotion} ${entry.intensity ?? 1}]${entry.text}[/${emotion}]`
    : entry.text;
  const result = synthesize(text, {
    lang: entry.lang,
    tier,
    seed: 1,
    // One headroom for every emotion keeps the effort audible as level.
    ...(emotion ? { markup: true, headroom: CHOICE_HEADROOM } : {}),
  });
  return resample(result.samples, result.sampleRate, STIMULUS.sampleRate);
}

/** The sounds of an entry in order: recording, tiers, extra files. */
function entrySounds(entry, dir) {
  const sounds = [];
  if (entry.reference) {
    sounds.push({
      name: 'reference',
      samples: () => readRecording(path.resolve(dir, entry.reference)),
    });
  }
  for (const tier of entry.tiers ?? []) {
    sounds.push({ name: tier, samples: () => render(entry, tier) });
  }
  for (const [name, file] of Object.entries(entry.extra ?? {})) {
    sounds.push({
      name,
      samples: () => readRecording(path.resolve(dir, file)),
    });
  }
  return sounds;
}

function mushraSounds(entry, dir) {
  const sounds = entrySounds(entry, dir);
  let reference = sounds.find((sound) => sound.name === 'reference');
  if (!reference) {
    const best = [...(entry.tiers ?? [])].sort(
      (a, b) => tierIndex(b) - tierIndex(a)
    )[0];
    const source = sounds.find((sound) => sound.name === best);
    if (!source) {
      throw new UsageError(
        `${entry.id}: a MUSHRA sentence needs a reference recording or a tier`
      );
    }
    reference = { name: 'reference', samples: source.samples, same: best };
    sounds.unshift(reference);
  }
  const rendered = new Map();
  const get = (sound) => {
    const key = sound.same ?? sound.name;
    if (!rendered.has(key)) {
      rendered.set(key, sound.samples());
    }
    return rendered.get(key);
  };
  const anchors = Object.entries(ANCHORS).map(([name, rate]) => ({
    name,
    samples: () => lowPassAnchor(get(reference), STIMULUS.sampleRate, rate),
  }));
  const all = [reference, ...anchors, ...sounds.slice(1)];
  if (all.length > MAX_CONDITIONS) {
    throw new UsageError(
      `${entry.id}: ${all.length} conditions, more than ${MAX_CONDITIONS}`
    );
  }
  return all.map((sound) => ({ name: sound.name, samples: () => get(sound) }));
}

function writeStimulus(out, id, name, samples, gain) {
  const relative = `stimuli/${id}/${name}.wav`;
  const file = path.join(out, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  const scaled =
    gain === undefined
      ? scaleToRms(samples)
      : Float32Array.from(samples, (value) => value * gain);
  let peak = 0;
  for (const value of scaled) {
    peak = Math.max(peak, Math.abs(value));
  }
  writeFileSync(
    file,
    encodeWav(scaled, STIMULUS.sampleRate, { bitDepth: STIMULUS.bitDepth })
  );
  return { relative, file, peak };
}

const peakOf = (samples) =>
  samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);

/**
 * The sounds of a choice sentence share one gain, so the loudness of an
 * emotion stays a cue: the gain that brings the first emotion (neutral in
 * the example) to the RMS of STIMULUS, lowered when a sound would clip.
 */
function buildChoice(entry, out) {
  const tier = entry.tiers?.[0] ?? CHOICE_TIER;
  const sounds = entry.emotions.map((emotion) => ({
    emotion,
    samples: render(entry, tier, emotion),
  }));
  const level = rmsDbfs(sounds[0].samples);
  const peak = Math.max(...sounds.map((sound) => peakOf(sound.samples)));
  const gain = Math.min(
    10 ** ((STIMULUS.rmsDbfs - level) / 20),
    CHOICE_PEAK / Math.max(peak, 1e-10)
  );
  return sounds.map(({ emotion, samples }) => ({
    type: 'choice',
    id: `${entry.id}-${emotion}`,
    audio: writeStimulus(out, entry.id, emotion, samples, gain).relative,
    choices: [...(entry.choices ?? entry.emotions)],
    answer: emotion,
    ...(entry.lang ? { lang: entry.lang } : {}),
    maxPlays: entry.maxPlays ?? 2,
  }));
}

function buildEntry(entry, dir, out, log) {
  const type = entry.type ?? 'mushra';
  if (type === 'choice') {
    return buildChoice(entry, out);
  }
  const sounds =
    type === 'mushra' ? mushraSounds(entry, dir) : entrySounds(entry, dir);
  const files = {};
  for (const sound of sounds) {
    const written = writeStimulus(out, entry.id, sound.name, sound.samples());
    if (written.peak > 1) {
      log(
        `warning: ${written.relative} clips (peak ${written.peak.toFixed(2)})`
      );
    }
    files[sound.name] = written.relative;
  }
  const names = Object.keys(files);
  if (type === 'mushra') {
    return [
      {
        type,
        id: entry.id,
        text: entry.text,
        reference: files.reference,
        conditions: files,
      },
    ];
  }
  if (type === 'abx') {
    if (names.length !== 2) {
      throw new UsageError(
        `${entry.id}: an ABX sentence needs exactly two sounds (reference, tiers and extra), not ${names.length}`
      );
    }
    return [{ type, id: entry.id, a: files[names[0]], b: files[names[1]] }];
  }
  return names.map((name) => ({
    type,
    id: names.length === 1 ? entry.id : `${entry.id}-${name}`,
    audio: files[name],
    text: entry.text,
    maxPlays: entry.maxPlays ?? 1,
  }));
}

/** The text of config.js for a configuration object. */
export function configSource(config) {
  return (
    '// Written by scripts/listening-test.mjs build; not committed.\n' +
    `globalThis.LISTENING_TEST_CONFIG = ${JSON.stringify(config, null, 2)};\n`
  );
}

/**
 * Render the stimuli of a study and write `<out>/stimuli/` and
 * `<out>/config.js`.
 * @param {{id: string, title?: string, instructions?: string, sentences: object[], dir?: string}} study
 * @param {string} out
 * @param {(line: string) => void} [log]
 * @returns {object} the configuration written to config.js
 */
export function buildStimuli(study, out, log = () => {}) {
  const seen = new Set();
  const problems = study.sentences.flatMap((entry, index) =>
    entryProblems(entry, index, seen)
  );
  if (problems.length > 0) {
    throw new UsageError(problems.join('\n'));
  }
  const dir = study.dir ?? process.cwd();
  const trials = [];
  for (const entry of study.sentences) {
    trials.push(...buildEntry(entry, dir, out, log));
    log(`${entry.id}: done`);
  }
  const volume = writeStimulus(
    out,
    '.',
    'volume',
    pinkNoise(VOLUME_SECONDS, STIMULUS.sampleRate)
  );
  const config = {
    id: String(study.id),
    title: study.title ?? 'Voice quality test',
    instructions:
      study.instructions ??
      'Please use headphones in a quiet room. Each trial plays short ' +
        'sentences; follow the instruction above each one.',
    volume: volume.relative.replace('stimuli/./', 'stimuli/'),
    trials,
  };
  writeFileSync(path.join(out, 'config.js'), configSource(config));
  return config;
}

// ---------------------------------------------------------------------------
// Statistics

/**
 * Bootstrap interval of a mean (Efron 1979): the mean of `values` and the
 * 2.5th and 97.5th percentiles (linear interpolation between order
 * statistics) of the means of `resamples` resamples drawn with replacement
 * with createRandom(seed).
 * @param {number[]} values
 * @param {{resamples?: number, seed?: number|string}} [options]
 * @returns {{mean: number, low: number, high: number, n: number}}
 */
export function bootstrapInterval(values, options = {}) {
  const { resamples = 10000, seed = 1 } = options;
  const n = values.length;
  if (n === 0) {
    return { mean: NaN, low: NaN, high: NaN, n };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const random = createRandom(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(random() * n)];
    }
    means[r] = sum / n;
  }
  means.sort();
  const percentile = (p) => {
    const position = p * (resamples - 1);
    const below = Math.floor(position);
    const above = Math.min(resamples - 1, below + 1);
    return means[below] + (means[above] - means[below]) * (position - below);
  };
  return { mean, low: percentile(0.025), high: percentile(0.975), n };
}

/**
 * Wilson (1927) score interval of a proportion, z = 1.959964 (95 %).
 * @returns {[number, number]}
 */
export function wilsonInterval(correct, total, z = Z95) {
  if (!(total > 0)) {
    return [NaN, NaN];
  }
  const p = correct / total;
  const z2 = z * z;
  const center = p + z2 / (2 * total);
  const spread =
    z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  const scale = 1 + z2 / total;
  return [(center - spread) / scale, (center + spread) / scale];
}

/** ln C(n, k) */
function logChoose(n, k) {
  let sum = 0;
  for (let i = 1; i <= k; i++) {
    sum += Math.log((n - k + i) / i);
  }
  return sum;
}

/**
 * Chance of at least `correct` right answers out of `total` by guessing
 * with a chance `p` per answer: sum over k >= correct of
 * C(n, k) p^k (1 - p)^(n - k) (one-sided binomial test).
 * @param {number} correct
 * @param {number} total
 * @param {number} p chance level, e.g. 1/6 for six choices
 */
export function binomialTailP(correct, total, p) {
  if (correct <= 0) {
    return 1;
  }
  if (correct > total || p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return 1;
  }
  const terms = [];
  for (let k = correct; k <= total; k++) {
    terms.push(
      logChoose(total, k) + k * Math.log(p) + (total - k) * Math.log1p(-p)
    );
  }
  const top = Math.max(...terms);
  const sum = terms.reduce((acc, term) => acc + Math.exp(term - top), 0);
  return Math.min(1, Math.exp(top) * sum);
}

/**
 * Chance of at least `correct` right answers out of `total` by guessing
 * between two answers: `binomialTailP(correct, total, 0.5)`.
 */
export function binomialTail(correct, total) {
  return binomialTailP(correct, total, 0.5);
}

// ---------------------------------------------------------------------------
// Analysis

const recordsOf = (result, type) =>
  (result.trials ?? []).filter((trial) => trial.type === type);

/**
 * Post-screening of BS.1534-3: drop a listener who rated the hidden
 * reference below 90 in more than 15 % of their MUSHRA trials.
 * @param {object[]} results result files
 * @returns {{kept: object[], dropped: object[]}}
 */
export function screenListeners(results) {
  const kept = [];
  const dropped = [];
  for (const result of results) {
    const trials = recordsOf(result, 'mushra');
    const low = trials.filter(
      (trial) => !(trial.ratings?.reference >= SCREENING.below)
    ).length;
    const careless = trials.length > 0 && low / trials.length > SCREENING.share;
    (careless ? dropped : kept).push(result);
  }
  return { kept, dropped };
}

const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Per listener: the mean rating of each condition over their trials. */
function listenerMeans(result) {
  const sums = new Map();
  for (const trial of recordsOf(result, 'mushra')) {
    for (const [name, rating] of Object.entries(trial.ratings ?? {})) {
      if (typeof rating === 'number') {
        const list = sums.get(name) ?? [];
        list.push(rating);
        sums.set(name, list);
      }
    }
  }
  return new Map([...sums].map(([name, list]) => [name, average(list)]));
}

function analyzeMushra(results) {
  const perListener = results.map(listenerMeans);
  const names = [...new Set(perListener.flatMap((means) => [...means.keys()]))];
  const conditions = names
    .map((name) => ({
      name,
      ...bootstrapInterval(
        perListener.filter((m) => m.has(name)).map((m) => m.get(name))
      ),
    }))
    .sort((a, b) => b.mean - a.mean || a.name.localeCompare(b.name));
  const pairs = [];
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      const [a, b] = [conditions[i].name, conditions[j].name];
      const differences = perListener
        .filter((m) => m.has(a) && m.has(b))
        .map((m) => m.get(a) - m.get(b));
      const interval = bootstrapInterval(differences);
      pairs.push({
        a,
        b,
        ...interval,
        different: interval.n > 0 && (interval.low > 0 || interval.high < 0),
      });
    }
  }
  const trials = results.reduce((n, r) => n + recordsOf(r, 'mushra').length, 0);
  return { trials, conditions, pairs };
}

function abxRow(id, records) {
  const total = records.length;
  const correct = records.filter((record) => record.correct === true).length;
  const [low, high] = wilsonInterval(correct, total);
  return {
    id,
    total,
    correct,
    proportion: total > 0 ? correct / total : NaN,
    low,
    high,
    p: binomialTail(correct, total),
  };
}

function groupById(records) {
  const groups = new Map();
  for (const record of records) {
    const list = groups.get(record.id) ?? [];
    list.push(record);
    groups.set(record.id, list);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

function analyzeAbx(results) {
  const records = results.flatMap((result) => recordsOf(result, 'abx'));
  const rows = groupById(records).map(([id, list]) => abxRow(id, list));
  return { trials: records.length, rows, all: abxRow('all', records) };
}

function analyzeIntelligibility(results, config) {
  const texts = new Map(
    (config?.trials ?? [])
      .filter((trial) => trial.type === 'intelligibility')
      .map((trial) => [trial.id, trial.text])
  );
  const perListener = [];
  const records = [];
  for (const result of results) {
    const own = [];
    for (const record of recordsOf(result, 'intelligibility')) {
      if (!texts.has(record.id)) {
        throw new UsageError(
          `intelligibility trial "${record.id}" is not in the configuration; pass --config <config.js> of the test`
        );
      }
      const wer = errorRate(texts.get(record.id), record.typed ?? '').rate;
      records.push({ id: record.id, wer });
      own.push(wer);
    }
    if (own.length > 0) {
      perListener.push(average(own));
    }
  }
  const rows = groupById(records).map(([id, list]) => ({
    id,
    ...bootstrapInterval(list.map((record) => record.wer)),
  }));
  return {
    trials: records.length,
    rows,
    all: { id: 'all', ...bootstrapInterval(perListener) },
  };
}

/** A row of the choice table: answers, correct, Wilson interval, p. */
function choiceRow(id, records, chance) {
  const total = records.length;
  const correct = records.filter((record) => record.correct).length;
  const [low, high] = wilsonInterval(correct, total);
  return {
    id,
    total,
    correct,
    proportion: total > 0 ? correct / total : NaN,
    low,
    high,
    p: binomialTailP(correct, total, chance),
  };
}

/**
 * Choice trials (issue 55): for every right answer (the emotion that was
 * played) the share of correct answers with its Wilson interval and the
 * one-sided binomial test against the chance level 1 / number of choices,
 * the same per language, and the confusion matrix (rows: answer, columns:
 * chosen; counts).
 */
function analyzeChoice(results, config) {
  const trials = new Map(
    (config?.trials ?? [])
      .filter((trial) => trial.type === 'choice')
      .map((trial) => [trial.id, trial])
  );
  const records = [];
  for (const result of results) {
    for (const record of recordsOf(result, 'choice')) {
      const trial = trials.get(record.id);
      if (!trial) {
        throw new UsageError(
          `choice trial "${record.id}" is not in the configuration; pass --config <config.js> of the test`
        );
      }
      records.push({
        id: record.id,
        answer: trial.answer,
        chosen: record.chosen ?? '',
        correct: record.chosen === trial.answer,
        lang: trial.lang ?? '',
        chance: 1 / trial.choices.length,
      });
    }
  }
  const answers = [...new Set([...trials.values()].map((t) => t.answer))];
  const labels = [
    ...new Set([...trials.values()].flatMap((trial) => trial.choices)),
  ];
  const chance =
    records.length > 0 ? average(records.map((record) => record.chance)) : NaN;
  const of = (filter) => records.filter(filter);
  const rows = answers.map((answer) =>
    choiceRow(
      answer,
      of((record) => record.answer === answer),
      chance
    )
  );
  const languages = [...new Set(records.map((record) => record.lang))];
  const byLanguage = languages.flatMap((lang) =>
    answers.map((answer) => ({
      lang,
      ...choiceRow(
        answer,
        of((record) => record.lang === lang && record.answer === answer),
        chance
      ),
    }))
  );
  const matrix = answers.map((answer) =>
    labels.map(
      (label) =>
        of((record) => record.answer === answer && record.chosen === label)
          .length
    )
  );
  const shares = rows.filter((row) => row.total > 0);
  return {
    trials: records.length,
    chance,
    rows,
    byLanguage,
    labels,
    answers,
    matrix,
    mean:
      shares.length > 0 ? average(shares.map((row) => row.proportion)) : NaN,
    all: choiceRow('all', records, chance),
  };
}

/**
 * Analyse result files: post-screening, MUSHRA means and pairs, ABX
 * proportions, intelligibility word error rates and the confusion matrix
 * of the choice trials.
 * @param {object[]} results
 * @param {{config?: object}} [options] the configuration of the test,
 *   needed for the reference text of the intelligibility trials and the
 *   answer and choices of the choice trials
 */
export function analyzeResults(results, options = {}) {
  const { kept, dropped } = screenListeners(results);
  return {
    tests: [...new Set(results.map((result) => result.test))],
    files: results.length,
    listeners: kept.length,
    dropped: dropped.map((result) => result.listener),
    mushra: analyzeMushra(kept),
    abx: analyzeAbx(kept),
    intelligibility: analyzeIntelligibility(kept, options.config),
    choice: analyzeChoice(kept, options.config),
  };
}

// ---------------------------------------------------------------------------
// Report

const fixed = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : '–';
const interval = (row, digits = 1) =>
  `${fixed(row.low, digits)} to ${fixed(row.high, digits)}`;
const probability = (p) =>
  !Number.isFinite(p) ? '–' : p < 0.0001 ? p.toExponential(2) : p.toFixed(4);

function table(head, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(head),
    line(head.map(() => '---')),
    ...rows.map((row) => line(row)),
  ].join('\n');
}

function mushraSection({ trials, conditions, pairs }) {
  if (trials === 0) {
    return '## MUSHRA\n\nNo MUSHRA trial.';
  }
  const rows = conditions.map((c) => [c.name, c.n, fixed(c.mean), interval(c)]);
  const differences = pairs.map(
    (pair) =>
      `- ${pair.a} − ${pair.b}: ${fixed(pair.mean)} (95 % interval ${interval(pair)}), ${pair.different ? 'different' : 'not different'}`
  );
  return [
    '## MUSHRA',
    `${trials} trials. Each listener's ratings of a condition are averaged first; the interval is a bootstrap of the mean over listeners (10 000 resamples, seed 1).`,
    table(['Condition', 'Listeners', 'Mean (0-100)', '95 % interval'], rows),
    'Differences of the per-listener means; a pair is different when the 95 % bootstrap interval does not contain 0:',
    differences.join('\n'),
  ].join('\n\n');
}

function abxSection({ trials, rows, all }) {
  if (trials === 0) {
    return '## ABX\n\nNo ABX trial.';
  }
  const line = (row) => [
    row.id,
    row.total,
    row.correct,
    fixed(row.proportion, 3),
    interval(row, 3),
    probability(row.p),
  ];
  return [
    '## ABX',
    `${trials} answers. Wilson 95 % interval of the share of correct answers; p is the chance of at least as many correct answers by guessing (one-sided binomial test).`,
    table(
      ['Trial', 'Answers', 'Correct', 'Share', '95 % interval', 'p'],
      [...rows.map(line), line(all)]
    ),
  ].join('\n\n');
}

function intelligibilitySection({ trials, rows, all }) {
  if (trials === 0) {
    return '## Intelligibility\n\nNo intelligibility trial.';
  }
  const line = (row) => [row.id, row.n, fixed(row.mean, 3), interval(row, 3)];
  return [
    '## Intelligibility',
    `${trials} answers. Word error rate of the typed words against the text (lower case, punctuation removed, Levenshtein distance over words divided by the number of words of the text); "all" averages each listener first. Intervals: bootstrap, 10 000 resamples, seed 1.`,
    table(
      ['Trial', 'Answers', 'Mean WER', '95 % interval'],
      [...rows.map(line), line({ ...all, id: 'all (listeners)' })]
    ),
  ].join('\n\n');
}

function choiceSection(choice) {
  if (choice.trials === 0) {
    return '## Choice\n\nNo choice trial.';
  }
  const line = (row) => [
    row.id,
    row.total,
    row.correct,
    fixed(row.proportion, 3),
    interval(row, 3),
    probability(row.p),
  ];
  const languages = choice.byLanguage
    .filter((row) => row.total > 0)
    .map((row) => [row.lang || '–', ...line(row)]);
  return [
    '## Choice',
    `${choice.trials} answers; chance level ${fixed(100 * choice.chance)} %. Wilson 95 % interval of the share of correct answers; p is the chance of at least as many correct answers by guessing (one-sided binomial test with the chance level). Mean share over the answers: ${fixed(100 * choice.mean)} %.`,
    table(
      ['Answer', 'Trials', 'Correct', 'Share', '95 % interval', 'p'],
      [...choice.rows.map(line), line(choice.all)]
    ),
    'Per language:',
    table(
      [
        'Language',
        'Answer',
        'Trials',
        'Correct',
        'Share',
        '95 % interval',
        'p',
      ],
      languages
    ),
    'Confusion matrix (rows: the emotion played, columns: the answer chosen; counts):',
    table(
      ['Played \\ chosen', ...choice.labels],
      choice.answers.map((answer, index) => [answer, ...choice.matrix[index]])
    ),
  ].join('\n\n');
}

/**
 * The Markdown report of an analysis.
 * @param {ReturnType<typeof analyzeResults>} analysis
 * @param {{command?: string}} [options]
 */
export function formatReport(analysis, options = {}) {
  const dropped =
    analysis.dropped.length > 0
      ? ` (${analysis.dropped.length} dropped by the post-screening of BS.1534-3: ${analysis.dropped.join(', ')})`
      : ' (0 dropped by the post-screening of BS.1534-3)';
  const trials = analysis.mushra.trials + analysis.abx.trials;
  const total =
    trials + analysis.intelligibility.trials + analysis.choice.trials;
  return `${[
    `# Listening test: ${analysis.tests.join(', ') || 'no result'}`,
    options.command ? `Command: \`${options.command}\`` : null,
    [
      `- Result files: ${analysis.files}`,
      `- Listeners: ${analysis.listeners}${dropped}`,
      `- Trials: ${total} (MUSHRA ${analysis.mushra.trials}, ABX ${analysis.abx.trials}, intelligibility ${analysis.intelligibility.trials}, choice ${analysis.choice.trials})`,
    ].join('\n'),
    analysis.listeners < MIN_LISTENERS
      ? `**Fewer than ${MIN_LISTENERS} listeners: these numbers do not support any claim.**`
      : null,
    mushraSection(analysis.mushra),
    abxSection(analysis.abx),
    intelligibilitySection(analysis.intelligibility),
    choiceSection(analysis.choice),
  ]
    .filter(Boolean)
    .join('\n\n')}\n`;
}

/**
 * Read a config.js written by `build` (or by hand): it is evaluated with a
 * stand-in for globalThis, so it sees no real global object.
 * @param {string} file
 */
export function loadConfig(file) {
  const scope = {};
  new Function('globalThis', readFileSync(file, 'utf8'))(scope);
  if (!isObject(scope.LISTENING_TEST_CONFIG)) {
    throw new UsageError(`${file} does not set LISTENING_TEST_CONFIG`);
  }
  return scope.LISTENING_TEST_CONFIG;
}

function readResult(file) {
  const result = JSON.parse(readFileSync(file, 'utf8'));
  if (
    !isObject(result) ||
    result.schema !== 1 ||
    !Array.isArray(result.trials)
  ) {
    throw new UsageError(`${file} is not a listening test result (schema 1)`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Semantically unpredictable sentences

/**
 * English semantically unpredictable sentences: the five frames of the
 * word list in turn, each slot filled with a word drawn with
 * createRandom(seed); no noun appears twice in a sentence.
 * @param {{count?: number, seed?: number|string, words?: object}} [options]
 * @returns {string[]}
 */
export function susSentences(options = {}) {
  const { count = 20, seed = 1 } = options;
  const words =
    options.words ?? JSON.parse(readFileSync(SUS_FILE('en'), 'utf8'));
  const random = createRandom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const sentences = [];
  for (let i = 0; i < count; i++) {
    const frame = words.frames[i % words.frames.length];
    const used = new Set();
    const noun = () => {
      let word = pick(words.nouns);
      while (used.has(word)) {
        word = pick(words.nouns);
      }
      used.add(word);
      return word;
    };
    const slots = {
      noun,
      adjective: () => pick(words.adjectives),
      base: () => pick(words.verbs).base,
      past: () => pick(words.verbs).past,
      preposition: () => pick(words.prepositions),
      question: () => pick(words.questions),
    };
    const sentence = frame.replace(/\{(\w+)\}/gu, (_, slot) => slots[slot]());
    sentences.push(sentence[0].toUpperCase() + sentence.slice(1));
  }
  return sentences;
}

// ---------------------------------------------------------------------------
// Command line

const FLAGS = new Set(['json', 'help']);
const VALUES = new Set(['sentences', 'out', 'config', 'lang', 'count', 'seed']);

export function parseArguments(argv) {
  const options = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (FLAGS.has(key)) {
        options[key] = true;
      } else if (VALUES.has(key) && i + 1 < argv.length) {
        options[key] = argv[++i];
      } else {
        throw new UsageError(`unknown or incomplete option ${arg}`);
      }
    } else if (!options.command) {
      options.command = arg;
    } else {
      options.files.push(arg);
    }
  }
  if (!options.help && !['build', 'analyze', 'sus'].includes(options.command)) {
    throw new UsageError(
      `unknown command "${options.command ?? ''}"\n${USAGE}`
    );
  }
  return options;
}

const quote = (arg) =>
  /^[\w@%+=:,./-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;

function buildCommand(options, out) {
  if (!isText(options.sentences)) {
    throw new UsageError('build needs --sentences <file.json>');
  }
  const study = readSentences(options.sentences);
  const folder = path.resolve(options.out ?? TEST_DIR);
  const config = buildStimuli(study, folder, (line) => out.log(line));
  out.log(
    `wrote ${config.trials.length} trials to ${path.join(folder, 'config.js')}`
  );
  return EXIT.ok;
}

function analyzeCommand(options, argv, out) {
  if (options.files.length === 0) {
    throw new UsageError('analyze needs at least one result file');
  }
  const results = options.files.map(readResult);
  const configFile = options.config ?? DEFAULT_CONFIG;
  const needsConfig = results.some(
    (result) =>
      recordsOf(result, 'intelligibility').length > 0 ||
      recordsOf(result, 'choice').length > 0
  );
  let config;
  if (existsSync(configFile)) {
    config = loadConfig(configFile);
  } else if (needsConfig) {
    throw new UsageError(
      `${configFile} not found; the intelligibility and choice trials need --config <config.js>`
    );
  }
  for (const result of results) {
    if (config && result.test !== config.id) {
      out.error(
        `warning: result of test "${result.test}", configuration of "${config.id}"`
      );
    }
  }
  const command = `node scripts/listening-test.mjs ${argv.map(quote).join(' ')}`;
  const analysis = analyzeResults(results, { config });
  const text = options.json
    ? `${JSON.stringify({ command, ...analysis }, null, 2)}\n`
    : formatReport(analysis, { command });
  if (options.out) {
    writeFileSync(options.out, text);
    out.log(`wrote ${options.out}`);
  } else {
    out.log(text.trimEnd());
  }
  return EXIT.ok;
}

function susCommand(options, out) {
  const lang = options.lang ?? 'en';
  if (lang !== 'en') {
    throw new UsageError(
      `no word lists for "${lang}": only English (en) is available; write the sentences of other languages into the sentences file`
    );
  }
  const count = Number(options.count ?? 20);
  if (!Number.isInteger(count) || count < 1) {
    throw new UsageError('--count must be a positive integer');
  }
  const seed = options.seed === undefined ? 1 : Number(options.seed);
  for (const sentence of susSentences({ count, seed })) {
    out.log(sentence);
  }
  return EXIT.ok;
}

/**
 * @param {string[]} [argv]
 * @param {{log: Function, error: Function}} [out]
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), out = console) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      out.log(USAGE);
      return EXIT.ok;
    }
    if (options.command === 'build') {
      return buildCommand(options, out);
    }
    return options.command === 'analyze'
      ? analyzeCommand(options, argv, out)
      : susCommand(options, out);
  } catch (error) {
    out.error(
      `listening-test: ${error instanceof UsageError ? error.message : (error?.stack ?? error)}`
    );
    return EXIT.usage;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
