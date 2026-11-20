/** Match observed phone spans against acoustic signatures from the waveguide. Unlicense. */
import {
  errorRate,
  parseIpa,
  planUtterance,
  renderPlan,
} from '../src/index.js';
import { phoneClass } from '../src/recognition/decode-model.js';
import { segmentsOf } from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { goldenCases } from './issue-153-golden.mjs';

const points = [0.22, 0.5, 0.78];
const scales = [16, 2.4, 3, 3.4, 2.2, 1.7, 1.5, 1.4, 1.3, 1.2, 1.1];

function frameProfile(frames) {
  return Array.from({ length: frames.count }, (_, frame) => {
    let peak = -Infinity;
    for (
      let i = Math.max(0, frame - 20);
      i < Math.min(frames.count, frame + 21);
      i++
    ) {
      peak = Math.max(peak, frames.energy[i]);
    }
    const row = [
      Math.max(-45, frames.energy[frame] - peak),
      frames.periodicity[frame] * 5,
      (frames.gravity[frame] / frames.rate) * 22,
    ];
    for (let coefficient = 1; coefficient < 9; coefficient++) {
      row.push(frames.cepstrum[frame * frames.cepstra + coefficient]);
    }
    return row.map((value, index) => value / scales[index]);
  });
}

function spanProfile(profile, hop, start, end) {
  return points.map((relative) => {
    const at = (start + relative * (end - start)) / hop;
    const floor = Math.min(profile.length - 1, Math.floor(at));
    const high = Math.min(profile.length - 1, floor + 1);
    return profile[floor].map(
      (value, index) => value + (at - floor) * (profile[high][index] - value)
    );
  });
}

function signature(ipa, context, voice, rate) {
  const plan = planUtterance(`${context}.${ipa}.${context}`, { head: voice });
  const samples = renderPlan(plan, {
    sampleRate: rate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const frames = analyzeFrames(samples, rate);
  const { start, end } = plannedPhones(plan)[1];
  return spanProfile(frameProfile(frames), frames.hop, start, end);
}

function templateBank(templates, voice, rate) {
  return templates.map(({ ipa }) =>
    ['i', 'a', 'u'].map((context) => signature(ipa, context, voice, rate))
  );
}

function distance(observed, expected) {
  return (
    observed.reduce(
      (sum, row, point) =>
        sum +
        row.reduce(
          (total, value, index) =>
            total +
            (index < 3 ? 2 : 1) *
              Math.min(9, (value - expected[point][index]) ** 2),
          0
        ),
      0
    ) /
    (observed.length * scales.length)
  );
}

function acousticCosts(prepared, frames, bank) {
  const profile = frameProfile(frames);
  return prepared.spans.map((row, from) =>
    row.map((span) => {
      if (span.pause) {
        return span;
      }
      const observed = spanProfile(
        profile,
        frames.hop,
        prepared.times[from],
        prepared.times[span.to]
      );
      const costs = bank.map((variants) =>
        Math.min(...variants.map((expected) => distance(observed, expected)))
      );
      return { ...span, costs };
    })
  );
}

// Acoustic weight, estimated articulation weight, phonotactic weight.
const conditions = [
  [0, 1, 2],
  [3, 0.5, 1],
  [6, 0.5, 1],
  [6, 0.1, 1],
  [6, 0.1, 2],
];
const totals = conditions.map(() => ({ phone: 0, broad: 0, count: 0 }));

function decode(spans, prepared, templates, settings, condition) {
  const [acoustic, articulation, phonotactic] = condition;
  const alternatives = spans.map((row) =>
    row.map((span) => {
      if (span.pause) {
        return span;
      }
      const terms = Float64Array.from(span.terms);
      for (let index = 0; index < templates.length; index++) {
        terms[index * 3] =
          articulation * terms[index * 3] + acoustic * span.costs[index];
      }
      return { ...span, terms };
    })
  );
  const search = decodeSearch(
    { ...prepared, spans: alternatives },
    settings.language,
    {
      ...settings,
      weights: { ...settings.weights, phonotactic },
      lattice: false,
    }
  );
  return segmentsOf(
    search.paths[0],
    prepared.times,
    templates,
    settings.language
  ).flatMap(({ ipa }) => parseIpa(ipa).tokens);
}

function phones(ipa) {
  return parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
}

let bank;
let bankKey;
for (const {
  speaker,
  rate,
  ipa,
  analysis,
  prepared,
  templates,
  settings,
} of goldenCases(process.argv[2])) {
  const key = `${speaker}:${rate}`;
  if (key !== bankKey) {
    bank = templateBank(templates, analysis.voice, rate);
    bankKey = key;
    console.log('rendered', speaker, rate);
  }
  const spans = acousticCosts(prepared, analysis.frames, bank);
  const reference = phones(ipa);
  for (const [i, condition] of conditions.entries()) {
    const decoded = decode(spans, prepared, templates, settings, condition);
    totals[i].phone += errorRate(
      reference.map(({ symbol }) => symbol),
      decoded.map(({ symbol }) => symbol).join(''),
      'phone'
    ).rate;
    totals[i].broad += errorRate(
      reference.map(phoneClass),
      decoded.map(phoneClass),
      'phone'
    ).rate;
    totals[i].count++;
  }
}

console.log('Condition | Phone error | Broad-class error');
for (const [index, { phone, broad, count }] of totals.entries()) {
  console.log(
    conditions[index].join(', '),
    ((100 * phone) / count).toFixed(2),
    ((100 * broad) / count).toFixed(2)
  );
}
