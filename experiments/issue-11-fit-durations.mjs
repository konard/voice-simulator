/**
 * Fit of the segment duration model of issue 39 (P27 of issue 11) to the
 * golden recordings of tests/fixtures/golden.
 *
 * 1. Every recording is planned with the durations of the plan before
 *    issue 39 (`todayDurations()` below keeps that code), rendered (tier
 *    minimal) and aligned with the recording by
 *    `alignToRecording(plan, audio, recording)` of
 *    experiments/issue-11-align.mjs. The aligned length of each token is
 *    its measured duration. Aligning against the old plan means any pull
 *    of the alignment towards the rendered plan favours the old code.
 * 2. A recording whose alignment cost (mean distance along the DTW path)
 *    is more than twice the median of its language is skipped.
 * 3. For each language: mean absolute error (ms per sound, pauses
 *    excluded) and Pearson correlation of the old code, of the starting
 *    table of src/articulation/durations.js and of the fitted table.
 * 4. Fit, two passes: the inherent duration of every class (and of every
 *    per-symbol entry) is the median over its sounds of the inherent
 *    duration that gives the measured length once the factors of the
 *    applying rules are removed; then every rule factor in turn is the
 *    value on a grid of 0.05 in 0.3 to 2 with the smallest error. A class
 *    or rule with fewer than MIN_EXAMPLES sounds keeps its starting value.
 *    A two-fold check fits on half of the recordings and scores the other
 *    half.
 *
 *   node experiments/issue-11-fit-durations.mjs [--measured <file.json>]
 *     [--out <file.txt>]
 *
 * Writes experiments/issue-11-fit-durations.txt and .json (the measured
 * durations; `--measured` reads them back and skips rendering).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import {
  getAudioTier,
  planUtterance,
  presetHeadConfig,
  renderPlan,
} from '../src/index.js';
import {
  DURATION_RULES,
  DURATION_TABLES,
  applyingRules,
  durationClass,
  durationFeatures,
  isAspirated,
  phonemeDurations,
  ruleFactor,
  segmentDuration,
} from '../src/articulation/durations.js';
import { consonantTarget } from '../src/articulation/phones.js';
import { BOUNDARIES, boundaryOf } from '../src/articulation/prosody.js';
import { resample } from '../src/audio/resample.js';
import { parseIpa } from '../src/ipa/parse.js';
import { loadGolden } from '../tests/helpers/golden.js';
import { alignToRecording } from './issue-11-align.mjs';

const SAMPLE_RATE = 16000;
const TIER = 'minimal';
const MIN_EXAMPLES = 20;
const GRID = Array.from({ length: 35 }, (_, i) =>
  Number((0.3 + i * 0.05).toFixed(2))
);
const PASSES = 2;
const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
/**
 * Longest measured sound (s) that the fit takes. The speakers pause where
 * the text has no punctuation, and the alignment hands such a pause to a
 * neighbouring sound, mostly a closure or a voiceless fricative (a 0.5 s
 * [p] in zh-02). Phrase-final vowels of read speech stay near 0.3 s
 * (Klatt 1976, JASA 59, 1208); 0.4 s leaves a margin.
 */
const LONGEST = 0.4;
/**
 * Rules that the fit leaves alone: `nonPhraseFinal` sets the ratio of
 * final to inner vowels that the head's `finalLengthening` stands for (see
 * the en table of src/articulation/durations.js).
 */
const FIXED = new Set(['nonPhraseFinal']);
/** Length (ms) of every sound in the uniform plan. */
const UNIFORM_MS = 90;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = option(
  '--out',
  fileURLToPath(new URL('./issue-11-fit-durations.txt', import.meta.url))
);
const JSON_OUT = OUT.replace(/\.txt$/, '.json');
const MEASURED = option('--measured', null);
/**
 * Rounds of re-alignment: each round renders the durations measured by the
 * round before and aligns again, so the measurement moves away from the
 * plan it started from (embedded re-estimation of forced alignment).
 */
const ITERATIONS = Number(option('--iterations', 0));
/** Weight of a diagonal DTW step: 2 is the symmetric form, 1 copies the plan. */
const DIAGONAL_WEIGHT = Number(option('--diagonal', 1));
/** Recordings per language (all by default), for quick probes. */
const LIMIT = Number(option('--limit', Infinity));
/** The plan whose alignment gives the measured durations of the fit. */
const REFERENCE = option('--reference', 'consensus');

// ------------------------------------------- the plan before issue 39

/** Consonant durations (ms) per manner in the plan before issue 39. */
const TODAY_MANNER_MS = {
  plosive: 75,
  nasal: 70,
  trill: 85,
  tap: 28,
  fricative: 105,
  'lateral-fricative': 105,
  approximant: 60,
  'lateral-approximant': 65,
};
const TODAY_REDUCED = new Set(['ə', 'ɐ', 'ɪ', 'ʊ', 'ɨ', 'ɚ']);
const TODAY_OFFGLIDES = new Set(['ɪ', 'ʊ', 'i', 'u', 'ə', 'ɚ', 'y', 'ɯ']);

function todayPhraseEnd(tokens, index) {
  for (let next = index + 1; next < tokens.length; next++) {
    const token = tokens[next];
    if (token.kind === 'pause' && token.strength >= 2) {
      return boundaryOf(token);
    }
    if (token.kind === 'vowel' || token.syllabic) {
      return null;
    }
  }
  return 'period';
}

function todayAspirated(tokens, index, language) {
  const token = tokens[index];
  if (token.aspirated) {
    return true;
  }
  if (language !== 'en' || token.voiced || token.phoneme.manner !== 'plosive') {
    return false;
  }
  const previous = tokens[index - 1];
  const wordInitial = !previous || previous.word !== token.word;
  let vowel = null;
  for (let next = index + 1; next < tokens.length; next++) {
    if (tokens[next].kind === 'pause') {
      break;
    }
    if (tokens[next].kind === 'vowel') {
      vowel = tokens[next];
      break;
    }
  }
  const adjacent = tokens[index + 1]?.kind === 'vowel';
  return Boolean(vowel && adjacent && (wordInitial || vowel.stress === 1));
}

function todayOffglide(tokens, index) {
  const token = tokens[index];
  const previous = tokens[index - 1];
  return (
    previous?.kind === 'vowel' &&
    previous.word === token.word &&
    !token.stress &&
    !token.long &&
    !token.tone &&
    TODAY_OFFGLIDES.has(token.base)
  );
}

function todayStress(token, context) {
  if (token.stress === 1) {
    return context.stressLengthening;
  }
  if (token.stress === 2) {
    return 1.15;
  }
  return TODAY_REDUCED.has(token.base) && !context.tonal ? 0.75 : 1;
}

function todayVowel(tokens, index, context) {
  const token = tokens[index];
  let duration = 0.105 * todayStress(token, context);
  duration *= token.long ? 1.7 : 1;
  duration *= todayOffglide(tokens, index) ? 0.6 : 1;
  duration *= context.tonal ? 1.15 : 1;
  const final = todayPhraseEnd(tokens, index);
  if (final) {
    const relative =
      (context.finalLengthening - 1) / (BOUNDARIES.period.lengthen - 1);
    const lengthen = BOUNDARIES[final]?.lengthen ?? 1.4;
    duration *= 1 + (lengthen - 1) * relative;
  }
  return duration * context.rate;
}

function todayConsonant(tokens, index, context) {
  const token = tokens[index];
  const final = todayPhraseEnd(tokens, index);
  const scale = context.rate * (final ? 1.2 : 1) * (token.long ? 1.8 : 1);
  let duration;
  if (token.affricate) {
    duration = 0.05 + 0.07 * scale;
  } else {
    const target = consonantTarget(token);
    const ms = token.syllabic ? 120 : TODAY_MANNER_MS[token.phoneme.manner];
    duration = (ms / 1000) * scale * (target.voicing ? 1 : 1.15);
  }
  const { manner, place } = token.phoneme;
  if (
    manner === 'plosive' &&
    !token.voiced &&
    !token.affricate &&
    place !== 'glottal'
  ) {
    const aspirated = todayAspirated(tokens, index, context.language);
    duration += (aspirated ? 0.06 : 0.015) * context.rate;
  }
  return duration;
}

/** Seconds per token as the plan before issue 39 gave them (null: pause). */
function todayDurations(tokens, language, head) {
  const context = {
    rate: 1 / head.speechRate,
    language,
    tonal: tokens.some((token) => token.tone),
    stressLengthening: head.stressLengthening ?? 1.35,
    finalLengthening: head.finalLengthening ?? 1.4,
  };
  return tokens.map((token, index) => {
    if (token.kind === 'pause') {
      return null;
    }
    if (token.kind === 'vowel') {
      return todayVowel(tokens, index, context);
    }
    return token.phoneme ? todayConsonant(tokens, index, context) : null;
  });
}

// ------------------------------------------------------- measurement

function render(plan) {
  const tier = getAudioTier(TIER);
  const samples = renderPlan(plan, {
    solver: tier.solver,
    sections: tier.sections,
    sampleRate: tier.sampleRate,
    head: plan.head,
    seed: 1,
  });
  return {
    samples: resample(samples, tier.sampleRate, SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  };
}

const headOf = (item) =>
  presetHeadConfig(
    (item.sex ?? item.speaker.sex) === 'male' ? 'male' : 'female'
  );

/** Seconds per token of a plan where every sound lasts UNIFORM_MS. */
function uniformDurations(tokens) {
  return tokens.map((token) =>
    token.kind === 'pause' ? null : UNIFORM_MS / 1000
  );
}

/** Seconds per token of the plan of src/articulation/durations.js. */
function modelDurations(tokens, language, head) {
  const plan = planUtterance(tokens, { head, language });
  const index = new Map(tokens.map((token, at) => [token, at]));
  const durations = tokens.map(() => null);
  for (const segment of plan.segments) {
    const at = index.get(segment.token);
    if (at !== undefined && tokens[at].kind !== 'pause') {
      durations[at] = (durations[at] ?? 0) + segment.duration;
    }
  }
  return durations;
}

const PLANS = {
  today: todayDurations,
  model: modelDurations,
  uniform: uniformDurations,
};

/** Measured durations of every recording, aligned against each plan. */
/** Mean absolute difference (ms) of two duration lists. */
function spread(a, b) {
  const pairs = a
    .map((value, index) => [value, b[index]])
    .filter(([x, y]) => x !== null && y !== null);
  const sum = pairs.reduce((total, [x, y]) => total + Math.abs(x - y), 0);
  return (1000 * sum) / Math.max(1, pairs.length);
}

/**
 * Align `item` against the plan of `durations`, then `ITERATIONS` more
 * times against a plan that takes the durations measured last.
 */
function alignChain(item, tokens, head, durations) {
  const rounds = [];
  let current = durations;
  for (let round = 0; round <= ITERATIONS; round++) {
    const plan = planUtterance(tokens, {
      head,
      language: item.lang,
      durations: current,
    });
    const aligned = alignToRecording(plan, render(plan), item, {
      diagonalWeight: DIAGONAL_WEIGHT,
    });
    rounds.push(aligned);
    current = aligned.durations;
  }
  return rounds;
}

function measure() {
  const items = [];
  const counts = {};
  for (const item of loadGolden()) {
    counts[item.lang] = (counts[item.lang] ?? 0) + 1;
    if (counts[item.lang] > LIMIT) {
      continue;
    }
    const started = Date.now();
    const head = headOf(item);
    const { tokens } = parseIpa(item.ipa);
    const entry = {
      id: item.id,
      lang: item.lang,
      ipa: item.ipa,
      sex: item.speaker.sex,
      cost: {},
      measured: {},
      rounds: {},
    };
    for (const [name, durations] of Object.entries(PLANS)) {
      const rounds = alignChain(
        item,
        tokens,
        head,
        durations(tokens, item.lang, head)
      );
      entry.cost[name] = rounds.at(-1).cost;
      entry.measured[name] = rounds.at(-1).durations;
      entry.rounds[name] = rounds.map((round) => round.durations);
    }
    const gaps = entry.rounds.today.map((durations, round) =>
      spread(durations, entry.rounds.uniform[round]).toFixed(1)
    );
    console.error(
      `${item.id} ${item.lang} ${((Date.now() - started) / 1000).toFixed(1)} s, today/uniform gap per round (ms): ${gaps.join(' ')}`
    );
    items.push(entry);
  }
  return items;
}

// ------------------------------------------------------------- model

/** Release segment (s) that the plan adds after a voiceless plosive. */
function releaseOf(tokens, index, language, rate) {
  const token = tokens[index];
  const { manner, place } = token.phoneme ?? {};
  if (
    token.kind === 'vowel' ||
    manner !== 'plosive' ||
    token.voiced ||
    token.affricate ||
    place === 'glottal'
  ) {
    return 0;
  }
  return (isAspirated(tokens, index, language) ? 0.06 : 0.015) / rate;
}

/** One example per aligned sound of the kept recordings. */
/**
 * The duration of sound `index` measured against `reference`. 'consensus'
 * is the median of the three alignments: each alignment pulls towards
 * the plan it rendered, the median of three different plans pulls less.
 */
function measuredOf(item, reference, index) {
  if (reference !== 'consensus') {
    return item.measured[reference][index];
  }
  const values = Object.keys(PLANS).map((name) => item.measured[name][index]);
  return values.includes(null) ? null : median(values);
}

/** The alignment cost of `item` against `reference`. */
function costOf(item, reference) {
  if (reference !== 'consensus') {
    return item.cost[reference];
  }
  return median(Object.keys(PLANS).map((name) => item.cost[name]));
}

function examples(items, reference) {
  const result = [];
  for (const item of items) {
    const head = headOf(item);
    const { tokens } = parseIpa(item.ipa);
    const today = todayDurations(tokens, item.lang, head);
    const options = {
      speechRate: head.speechRate,
      stressLengthening: head.stressLengthening,
      finalLengthening: head.finalLengthening,
    };
    tokens.forEach((token, index) => {
      const measured = measuredOf(item, reference, index);
      if (
        token.kind === 'pause' ||
        !token.phoneme ||
        measured === null ||
        measured > LONGEST
      ) {
        return;
      }
      result.push({
        id: item.id,
        lang: item.lang,
        token,
        symbol: token.symbol,
        features: durationFeatures(tokens, index, { language: item.lang }),
        options,
        release: releaseOf(tokens, index, item.lang, head.speechRate),
        today: today[index],
        measured,
      });
    });
  }
  return result;
}

const predict = (example, table) =>
  segmentDuration(example.token, example.features, table, example.options) +
  example.release;

function score(list, model) {
  if (!list.length) {
    return { count: 0, mae: null, correlation: null };
  }
  const predicted = list.map(model);
  const measured = list.map((example) => example.measured);
  const mae =
    (predicted.reduce((sum, p, i) => sum + Math.abs(p - measured[i]), 0) /
      list.length) *
    1000;
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const mp = mean(predicted);
  const mm = mean(measured);
  let covariance = 0;
  let vp = 0;
  let vm = 0;
  predicted.forEach((p, i) => {
    covariance += (p - mp) * (measured[i] - mm);
    vp += (p - mp) ** 2;
    vm += (measured[i] - mm) ** 2;
  });
  return {
    count: list.length,
    mae,
    correlation: covariance / Math.sqrt(vp * vm || 1),
  };
}

/** A mutable copy of a table of DURATION_TABLES. */
function copyTable(table) {
  return {
    classes: Object.fromEntries(
      Object.entries(table.classes).map(([k, v]) => [k, { ...v }])
    ),
    symbols: Object.fromEntries(
      Object.entries(table.symbols).map(([k, v]) => [k, { ...v }])
    ),
    rules: Object.fromEntries(
      DURATION_RULES.map((rule) => [rule.name, ruleFactor(rule, table)])
    ),
    diphthongMain: table.diphthongMain,
    affricate: { ...table.affricate },
  };
}

/** The table entry (class or symbol) that gives a one-part token its value. */
function entryKey(example, table) {
  const { token, features } = example;
  if (token.affricate) {
    return null;
  }
  const name = durationClass(token, features, table);
  if (name === 'diphthong') {
    const symbol = features.nucleusSymbol;
    return table.symbols[symbol] ? ['symbols', symbol] : ['classes', name];
  }
  const long = token.long ? `${token.base}ː` : null;
  for (const symbol of [long, token.symbol, token.base]) {
    if (symbol && table.symbols[symbol]) {
      return ['symbols', symbol];
    }
  }
  return ['classes', name];
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Inherent duration (ms) that gives the measured length of one example
 * after taking away the factors of its rules.
 */
function impliedInherent(example, table) {
  const { token, features, options } = example;
  const rate = options.speechRate ?? 1;
  let percent = 100;
  let minimumFactor = 1;
  let total = 1;
  let added = 0;
  for (const { rule, factor } of applyingRules(
    token,
    features,
    table,
    options
  )) {
    const scope = rule.scope ?? 'percent';
    if (scope === 'percent') {
      percent *= factor;
    } else if (scope === 'minimum') {
      minimumFactor *= factor;
    } else if (scope === 'total') {
      total *= factor;
    } else {
      added += factor;
    }
  }
  const [part] = phonemeDurations(token, features, table);
  const [where, key] = entryKey(example, table);
  const share = part.minimum / table[where][key].minimum;
  const floor = part.minimum * minimumFactor;
  const ms =
    ((example.measured - example.release) * 1000) / total - added / rate ** 0.5;
  const stretch = ((ms - floor / rate ** 0.5) * rate ** 1.2 * 100) / percent;
  return (floor + stretch) / share;
}

function fitInherent(list, table, log) {
  const groups = new Map();
  for (const example of list) {
    const key = entryKey(example, table);
    if (!key) {
      continue;
    }
    const name = key.join('.');
    const group = groups.get(name) ?? { key, values: [] };
    group.values.push(impliedInherent(example, table));
    groups.set(name, group);
  }
  for (const [name, { key, values }] of groups) {
    const entry = table[key[0]][key[1]];
    if (values.length < MIN_EXAMPLES) {
      log?.(
        `    ${name.padEnd(28)} ${String(values.length).padStart(4)} sounds, keeps ${entry.inherent}`
      );
      continue;
    }
    const value = Math.max(entry.minimum, Math.round(median(values)));
    log?.(
      `    ${name.padEnd(28)} ${String(values.length).padStart(4)} sounds, inherent ${entry.inherent} -> ${value}`
    );
    entry.inherent = value;
  }
}

function fitRules(list, table, origin, log) {
  for (const rule of DURATION_RULES) {
    const start = table.rules[rule.name];
    if (start === null || rule.scope === 'add') {
      continue;
    }
    if (FIXED.has(rule.name)) {
      log?.(`    ${rule.name.padEnd(28)}      fixed at ${start}`);
      continue;
    }
    const count = list.filter((example) =>
      applyingRules(
        example.token,
        example.features,
        table,
        example.options
      ).some((entry) => entry.rule === rule)
    ).length;
    if (count < MIN_EXAMPLES) {
      log?.(
        `    ${rule.name.padEnd(28)} ${String(count).padStart(4)} sounds, keeps ${start}`
      );
      continue;
    }
    let best = {
      factor: start,
      mae: score(list, (e) => predict(e, table)).mae,
    };
    // The literature fixes the direction of a rule, the noisy alignment
    // only its size: a lengthening rule stays at 1 or above, a shortening
    // one at 1 or below.
    const direction = Math.sign(origin.rules[rule.name] - 1);
    for (const factor of GRID.filter((x) => (x - 1) * direction >= 0)) {
      table.rules[rule.name] = factor;
      const { mae } = score(list, (e) => predict(e, table));
      if (mae < best.mae - 1e-9) {
        best = { factor, mae };
      }
    }
    table.rules[rule.name] = best.factor;
    log?.(
      `    ${rule.name.padEnd(28)} ${String(count).padStart(4)} sounds, factor ${start} -> ${best.factor} (MAE ${best.mae.toFixed(1)} ms)`
    );
  }
}

function fit(list, language, log) {
  const table = copyTable(DURATION_TABLES[language]);
  for (let pass = 1; pass <= PASSES; pass++) {
    log?.(`  pass ${pass}: inherent durations`);
    fitInherent(list, table, log);
    log?.(`  pass ${pass}: rule factors`);
    fitRules(list, table, DURATION_TABLES[language], log);
  }
  return table;
}

// -------------------------------------------------------------- main

const lines = [];
const print = (line = '') => {
  lines.push(line);
  console.log(line);
};

const fmt = (value, digits = 1) =>
  value === null ? '-' : value.toFixed(digits);

const items = MEASURED
  ? JSON.parse(readFileSync(MEASURED, 'utf8')).items
  : measure();
if (!MEASURED) {
  writeFileSync(JSON_OUT, `${JSON.stringify({ items }, null, 1)}\n`);
}

print('Segment durations against the golden recordings (issue 39)');
print(`node experiments/issue-11-fit-durations.mjs --reference ${REFERENCE}`);
print('');
print(
  `Alignment cost per recording against the ${REFERENCE} plan (skipped when more than twice the median of its language):`
);
const kept = [];
for (const language of LANGUAGES) {
  const own = items.filter((item) => item.lang === language);
  const limit = 2 * median(own.map((item) => costOf(item, REFERENCE)));
  for (const item of own) {
    const cost = costOf(item, REFERENCE);
    if (cost <= limit) {
      kept.push(item);
    }
    print(
      `  ${item.id.padEnd(8)} ${language} cost ${cost.toFixed(2)}${cost > limit ? '  skipped' : ''}`
    );
  }
}

print('');
print(
  'The alignment pulls the measured durations towards the plan that was rendered.'
);
print(
  'MAE (ms per sound) of each model against the durations aligned with each plan:'
);
print('  lang  aligned with   today   model');
for (const language of LANGUAGES) {
  for (const name of [...Object.keys(PLANS), 'consensus']) {
    const list = examples(kept, name).filter((e) => e.lang === language);
    print(
      `  ${language.padEnd(4)}  ${name.padEnd(12)}  ${fmt(score(list, (e) => e.today).mae).padStart(6)}  ${fmt(score(list, (e) => predict(e, DURATION_TABLES[language])).mae).padStart(6)}`
    );
  }
}

const all = examples(kept, REFERENCE);
const fitted = {};
print('');
print(`MAE (ms per sound) and correlation against the ${REFERENCE} alignment:`);
print(
  '  lang  sounds   today MAE  r      model MAE  r      refit MAE  r       gain'
);
const report = [];
for (const language of LANGUAGES) {
  const list = all.filter((example) => example.lang === language);
  const log = [];
  fitted[language] = fit(list, language, (line) => log.push(line));
  const today = score(list, (e) => e.today);
  const start = score(list, (e) => predict(e, DURATION_TABLES[language]));
  const after = score(list, (e) => predict(e, fitted[language]));
  report.push({ language, log });
  print(
    `  ${language.padEnd(4)}  ${String(list.length).padStart(6)}   ${fmt(today.mae).padStart(9)}  ${fmt(today.correlation, 2)}   ${fmt(start.mae).padStart(9)}  ${fmt(start.correlation, 2)}   ${fmt(after.mae).padStart(10)}  ${fmt(after.correlation, 2)}   ${fmt((1 - after.mae / today.mae) * 100)} %`
  );
}

print('');
print('Two-fold check (fit on odd or even recordings, score the others):');
print('  lang  today MAE  model MAE  refit MAE');
for (const language of LANGUAGES) {
  const ids = kept
    .filter((item) => item.lang === language)
    .map((item) => item.id);
  const scores = { today: 0, start: 0, fitted: 0, count: 0 };
  for (const fold of [0, 1]) {
    const train = new Set(ids.filter((_, i) => i % 2 === fold));
    const list = all.filter((e) => e.lang === language);
    const test = list.filter((e) => !train.has(e.id));
    const table = fit(
      list.filter((e) => train.has(e.id)),
      language
    );
    const weight = test.length;
    scores.today += score(test, (e) => e.today).mae * weight;
    scores.start +=
      score(test, (e) => predict(e, DURATION_TABLES[language])).mae * weight;
    scores.fitted += score(test, (e) => predict(e, table)).mae * weight;
    scores.count += weight;
  }
  print(
    `  ${language.padEnd(4)}  ${fmt(scores.today / scores.count).padStart(9)}  ${fmt(scores.start / scores.count).padStart(9)}  ${fmt(scores.fitted / scores.count).padStart(10)}`
  );
}

print('');
print('MAE (ms) per sound class, today / model / refit:');
for (const language of LANGUAGES) {
  const list = all.filter((example) => example.lang === language);
  const classes = new Map();
  for (const example of list) {
    const name = example.token.affricate
      ? 'affricate'
      : durationClass(
          example.token,
          example.features,
          DURATION_TABLES[language]
        );
    classes.set(name, [...(classes.get(name) ?? []), example]);
  }
  print(`  ${language}`);
  for (const [name, group] of [...classes].sort()) {
    print(
      `    ${name.padEnd(20)} ${String(group.length).padStart(4)}  ${fmt(score(group, (e) => e.today).mae).padStart(6)}  ${fmt(score(group, (e) => predict(e, DURATION_TABLES[language])).mae).padStart(6)}  ${fmt(score(group, (e) => predict(e, fitted[language])).mae).padStart(6)}`
    );
  }
}

print('');
print('Fit log:');
for (const { language, log } of report) {
  print(`  ${language}`);
  log.forEach((line) => print(line));
}

print('');
print('Refitted tables (inherent/minimum ms; rule factors):');
for (const language of LANGUAGES) {
  const table = fitted[language];
  print(`  ${language}`);
  for (const [name, value] of Object.entries(table.classes)) {
    print(`    class ${name.padEnd(22)} ${value.inherent}/${value.minimum}`);
  }
  for (const [name, value] of Object.entries(table.symbols)) {
    print(`    symbol ${name.padEnd(21)} ${value.inherent}/${value.minimum}`);
  }
  for (const [name, value] of Object.entries(table.rules)) {
    print(`    rule ${name.padEnd(23)} ${value}`);
  }
}

writeFileSync(OUT, `${lines.join('\n')}\n`);
