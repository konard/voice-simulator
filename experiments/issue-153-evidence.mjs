// Compare closed-form acoustic evidence with the original span score. Unlicense.
import { errorRate, parseIpa } from '../src/index.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { decoderUnit, phoneClass } from '../src/recognition/decode-model.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { segmentsOf } from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { goldenCases } from './issue-153-golden.mjs';

const clip = (v) => Math.max(0, Math.min(1, v));
const vowels = {
  ...HILLENBRAND.male,
  a: [740, 1550, 2500],
  ə: [490, 1450, 2550],
  ɚ: [475, 1379, 1711],
  ɐ: [625, 1480, 2500],
  ɨ: [350, 1550, 2450],
  ɤ: [490, 1140, 2440],
  y: [350, 2000, 2470],
  ɜ: [570, 1510, 2530],
  ɒ: [700, 1000, 2500],
};
function median(a) {
  return a.length ? a.sort((x, y) => x - y)[a.length >> 1] : NaN;
}
function nearby(frames, col, t, radius) {
  return frames[col].subarray(
    Math.max(t - radius, 0),
    Math.min(frames.count, t + radius + 1)
  );
}
function observe(analysis) {
  const {
    frames,
    tracks: { pitch, formants },
    voice,
  } = analysis;
  const radius = Math.round(0.075 / frames.hop);
  const profile = [];
  for (let t = 0; t < frames.count; t++) {
    const energy = frames.energy[t];
    const peak = Math.max(...nearby(frames, 'energy', t, radius));
    const loss = peak - energy;
    const p = clip((frames.periodicity[t] - 0.28) / 0.46);
    const voiceProb = 0.6 * p + 0.4 * Number(pitch.f0[t] > 0);
    const gravity = frames.gravity[t];
    const noise = clip((gravity - 1000) / (frames.rate === 8000 ? 1600 : 3000));
    const loud = 1 - clip((loss - 3) / 19);
    const tilt =
      frames.band[6 * t] -
      Math.max(frames.band[6 * t + 1], frames.band[6 * t + 2]);
    const weak = clip((tilt - 10) / 20);
    const isolated = clip((loss - 15) / 20);
    const nasal =
      voiceProb * (0.6 * weak + 0.4 * formants.nasal[t]) * (1 - isolated);
    const silence = clip((loss - 9) / 18);
    const mouth = 1 - 0.65 * nasal;
    profile.push({
      vowel: voiceProb * loud * mouth,
      nasal,
      glide:
        voiceProb *
        (0.4 + 0.6 * (1 - loud)) *
        (1 - 0.7 * nasal) *
        (1 - isolated),
      stop: silence * (1 - 0.55 * noise),
      fric: (0.35 + 0.65 * noise) * (1 - isolated),
      voice: voiceProb,
      gravity,
    });
  }
  return { profile, formants, scale: 16.5 / voice.vocalTractLength };
}
function average(rows, k) {
  return rows.reduce((sum, row) => sum + row[k], 0) / Math.max(1, rows.length);
}
function vowelCost(base, span, scale) {
  const f = span.formants;
  const ideal = vowels[base] ?? vowels.ə;
  const f1 = Number.isFinite(f[0])
    ? Math.min(4, ((f[0] / scale - ideal[0]) / 135) ** 2)
    : 1;
  const f2 = Number.isFinite(f[1])
    ? Math.min(4, ((f[1] / scale - ideal[1]) / 285) ** 2)
    : 1;
  const f3 = Number.isFinite(f[2])
    ? Math.min(3, ((f[2] / scale - ideal[2]) / 530) ** 2)
    : 1;
  return span.cost.vowel + 0.48 * (f1 + f2 + 0.5 * f3);
}

function acoustic(unit, span, scale, bandwidth) {
  const { token } = unit;
  const manner = phoneClass(token);
  const base = token.base;
  if (manner === 'vowel') {
    return vowelCost(base, span, scale);
  }
  if (manner === 'nasal') {
    const place = token.phoneme.place;
    const ideal = place === 'bilabial' ? 1050 : place === 'velar' ? 1800 : 1580;
    const f2 = span.formants[1];
    return (
      span.cost.nasal +
      (Number.isFinite(f2)
        ? Math.min(0.8, ((f2 / scale - ideal) / 550) ** 2) / 2
        : 0)
    );
  }
  if (manner === 'glide') {
    const target =
      { l: 1450, ɫ: 1000, j: 2300, w: 900, ɥ: 1800, r: 1450, ɹ: 1450, ʋ: 1150 }[
        base
      ] ?? 1500;
    const f2 = span.formants[1];
    const tap = token.phoneme.manner === 'tap' ? 0.8 * span.cost.stop : 0;
    const place = Number.isFinite(f2)
      ? Math.min(1.6, ((f2 / scale - target) / 500) ** 2) / 2
      : 0.4;
    return span.cost.glide + place + tap;
  }
  return obstruentCost(token, manner, span, scale, bandwidth);
}

function obstruentCost(token, manner, span, scale, bandwidth) {
  const { place, sibilant } = token.phoneme;
  const back = [
    'postalveolar',
    'retroflex',
    'alveolopalatal',
    'palatal',
  ].includes(place);
  const ideal =
    sibilant || token.affricate
      ? back
        ? 0.49
        : 0.76
      : place === 'velar'
        ? 0.4
        : 0.34;
  const spectral = Math.min(
    1.8,
    ((span.gravity / bandwidth - ideal) / 0.23) ** 2
  );
  const voiced = Number(token.voiced);
  if (manner === 'closure') {
    const close = span.cost.stop;
    const idealF2 =
      place === 'bilabial' ? 1100 : place === 'velar' ? 1870 : 1640;
    const formant = Number.isFinite(span.afterF2)
      ? Math.min(1, ((span.afterF2 / scale - idealF2) / 650) ** 2)
      : 0.4;
    return (
      close +
      0.5 * (span.voice - 0.6 * voiced) ** 2 +
      0.35 * formant +
      (token.affricate ? 0.35 + 0.35 * spectral : 0)
    );
  }
  return span.cost.fric + 1.7 * (span.voice - voiced) ** 2 + 0.55 * spectral;
}
function spanFeatures(profile, formants, from, to) {
  const rows = profile.slice(from, to);
  const middle = rows.slice(
    Math.floor(rows.length * 0.2),
    Math.ceil(rows.length * 0.85)
  );
  const beginning = rows.slice(0, Math.ceil(rows.length * 0.6));
  const first = from + Math.floor(rows.length * 0.2);
  const last = from + Math.ceil(rows.length * 0.85);
  const observed = [0, 1, 2].map((col) =>
    median(
      middle
        .map(({ voice }, i) =>
          voice > 0.45 ? formants.frequency[4 * (first + i) + col] : NaN
        )
        .filter(Number.isFinite)
    )
  );
  const cost = {};
  for (const k of ['vowel', 'glide', 'nasal', 'stop', 'fric']) {
    const estimate = average(k === 'stop' ? beginning : middle, k);
    cost[k] = -Math.log(0.07 + 0.93 * estimate);
  }
  return {
    gravity: average(middle, 'gravity'),
    voice: average(middle, 'voice'),
    formants: observed,
    cost,
    afterF2: formants.frequency[4 * Math.min(formants.count - 1, last + 2) + 1],
  };
}

function spanOptions(analysis, templates, prepared) {
  const { frames } = analysis;
  const { profile, formants, scale } = observe(analysis);
  const { times, spans } = prepared;
  for (const [from, row] of spans.entries()) {
    for (const span of row) {
      if (span.pause) {
        continue;
      }
      const duration = times[span.to] - times[from];
      const at = (time) =>
        Math.min(frames.count, Math.round(time / frames.hop));
      const features = spanFeatures(
        profile,
        formants,
        at(times[from]),
        at(times[span.to])
      );
      span.evidence = templates.map((unit) =>
        acoustic(unit, features, scale, frames.rate / 2)
      );
      span.duration = duration;
    }
  }
}
// Each row gives duration, class and phonotactic weights, a nominal duration
// multiplier, raw acoustic and articulation weights, and a span duration power
// (0 for a fixed score, 1 for square-root weighting, 2 for frame weighting).
const acousticGrid = [
  [1, 4, 2, 1, 0, 0, 0],
  [1, 4, 0.2, 0.7, 0, 0, 0],
  [1, 4, 0.2, 0.7, 0, 0, 1],
  [1, 4, 0.6, 0.6, 0, 0, 1],
  [0.7, 2, 0.2, 0.65, 3, 0, 0],
  [0.7, 0, 0.2, 0.65, 3, 0, 0],
  [0.7, 0, 0.2, 0.65, 3, 0, 1],
  [1.2, 0, 0.5, 0.55, 3, 0, 1],
  [0.7, 0, 0.35, 0.65, 3, 0.4, 1],
  [0.7, 0, 0.35, 0.65, 3, 0.4, 0],
  [0.7, 1, 0.35, 0.65, 3, 0.4, 0],
  [0.7, 0, 0.35, 0.75, 3, 0.4, 2],
  [0.7, 0, 0.7, 0.65, 3, 0.4, 1],
  [0.7, 0, 0.15, 0.65, 3, 0.4, 1],
];
// The final column selects the original table (0), dictionary bigrams (1),
// dictionary unigrams (2), or their interpolation (3).
const lexicalGrid = [
  [1, 4, 2, 1, 0, 0, 0, 0],
  [1, 4, 2, 1, 0, 0, 0, 1],
  [1, 4, 1, 1, 0, 0, 0, 1],
  [1, 4, 3, 1, 0, 0, 0, 1],
  [1, 4, 2, 1, 0, 0, 0, 2],
  [0.7, 0, 0.7, 0.65, 3, 0.4, 1, 0],
  [0.7, 0, 0.7, 0.65, 3, 0.4, 1, 1],
  [0.7, 0, 1.5, 0.65, 3, 0.4, 1, 1],
  [0.7, 0, 0.7, 0.65, 3, 0.4, 1, 2],
  [0.7, 0, 0.7, 0.65, 3, 0.4, 1, 3],
  [1.4, 0, 1.8, 0.65, 3, 0.4, 1, 3],
];
const lexical = process.env.LEXICAL_PRIOR === '1';
const grid = (lexical ? lexicalGrid : acousticGrid).map((parameters) => ({
  parameters,
  scores: [],
}));
const languageCosts = new Map();
function lexicalCosts(language, symbols) {
  if (languageCosts.has(language)) {
    return languageCosts.get(language);
  }
  const width = symbols.length;
  const ids = new Map(symbols.map((symbol, index) => [symbol, index]));
  const counts = new Float64Array((width + 1) * (width + 1)).fill(0.5);
  const prior = new Float64Array(width);
  const size = width + 1;
  const stack = [getLexicon(language).root];
  while (stack.length) {
    const node = stack.pop();
    for (const child of node.children.values()) {
      stack.push(child);
    }
    for (const entry of node.entries) {
      const count = entry.count;
      const units = entry.tokens.map(decoderUnit).map((unit) => ids.get(unit));
      for (let i = 0; i <= units.length; i++) {
        const a = i === 0 ? width : units[i - 1];
        const b = i === units.length ? width : units[i];
        if (a !== undefined && b !== undefined) {
          counts[a * size + b] += count;
        }
        if (b < width) {
          prior[b] += count;
        }
      }
    }
  }
  const distribution = prior.reduce((sum, value) => sum + value, 0);
  for (let a = 0; a <= width; a++) {
    const row = counts.subarray(a * size, (a + 1) * size);
    const total = row.reduce((sum, value) => sum + value, 0);
    for (let b = 0; b <= width; b++) {
      row[b] /= total;
    }
  }
  const smoothed = counts.map((value, index) =>
    index % size < width
      ? 0.8 * value + (0.2 * prior[index % size]) / distribution
      : 0.8 * value
  );
  const costs = [
    new Float64Array((width + 1) * width),
    new Float64Array((width + 1) * width),
    new Float64Array((width + 1) * width),
  ];
  for (let a = 0; a <= width; a++) {
    for (let b = 0; b < width; b++) {
      costs[0][a * width + b] = -Math.log(
        Math.max(
          smoothed[a * size + b],
          smoothed[a * size + width] * smoothed[width * size + b]
        )
      );
      costs[1][a * width + b] = -Math.log(prior[b] / distribution);
      costs[2][a * width + b] = -Math.log(
        0.45 * smoothed[a * size + b] + (0.55 * prior[b]) / distribution
      );
    }
  }
  languageCosts.set(language, costs);
  return costs;
}
function updateSpanScores(prepared, templates, parameters) {
  const [, , , shorter, evidence, articulation, integrate] = parameters;
  for (const row of prepared.spans) {
    for (const span of row) {
      if (span.pause) {
        continue;
      }
      const scale = (span.duration / 0.07) ** (integrate * 0.5);
      span.terms = Float64Array.from(span.original);
      for (let i = 0; i < templates.length; i++) {
        const original = span.original[i * 3];
        const acoustic = evidence
          ? articulation * original + evidence * span.evidence[i]
          : original;
        span.terms[i * 3] = scale * acoustic;
        const ratio = span.duration / (templates[i].duration * shorter);
        span.terms[i * 3 + 1] = 2 * Math.log(ratio) ** 2;
        span.terms[i * 3 + 2] *= scale;
      }
    }
  }
}

function evaluateConditions(prepared, templates, settings, language, expected) {
  for (const row of prepared.spans) {
    for (const span of row) {
      span.original = span.terms;
    }
  }
  const phones = expected.map(({ symbol }) => symbol);
  const broadClasses = expected.map(phoneClass);
  for (const { parameters, scores } of grid) {
    const [duration, broadClass, phonotactic, , , , , prior] = parameters;
    updateSpanScores(prepared, templates, parameters);
    const model = prior
      ? {
          ...settings.language,
          costs: lexicalCosts(language, settings.language.symbols)[prior - 1],
        }
      : settings.language;
    const search = decodeSearch(prepared, model, {
      ...settings,
      weights: { duration, class: broadClass, phonotactic },
      lattice: false,
    });
    const segments = segmentsOf(
      search.paths[0],
      prepared.times,
      templates,
      settings.language
    );
    const decoded = segments
      .filter(({ kind }) => kind !== 'pause')
      .map(({ ipa }) => parseIpa(ipa).tokens[0]);
    scores.push({
      language,
      phone: errorRate(
        phones,
        decoded.map(({ symbol }) => symbol).join(''),
        'phone'
      ).rate,
      classes: errorRate(broadClasses, decoded.map(phoneClass), 'phone').rate,
      count: decoded.length,
    });
  }
}

const phones = (ipa) =>
  parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
for (const {
  lang,
  ipa,
  analysis,
  prepared,
  templates,
  settings,
} of goldenCases(process.argv[2])) {
  spanOptions(analysis, templates, prepared);
  evaluateConditions(prepared, templates, settings, lang, phones(ipa));
}
for (const { parameters, scores } of grid) {
  const results = ['en', 'ru', 'hi', 'zh', 'all'].map((language) =>
    ['phone', 'classes', 'count']
      .map((key) =>
        average(
          scores.filter(
            (row) => language === 'all' || language === row.language
          ),
          key
        ).toFixed(3)
      )
      .join('/')
  );
  console.log(parameters.join(' '), results.join('  '));
}
