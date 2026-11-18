// Unlicense. Issue 63: stage A tract (17500 / median dF) over the true tract
// of the default head for texts other than the heavy north-wind sentence.
// Is there one text-averaged factor, calibrated without the test sentence?
// Usage: node tract-texts.mjs
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import {
  accumulate,
  emptyState,
  stateFeatures,
} from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const HEAVY =
  'The north wind and the sun were disputing which was the stronger.';
// MATCH_TEXT, two sentences of syllable-rate-texts.mjs and Harvard
// sentences (IEEE 1969, list 1).
const texts = [
  MATCH_TEXT,
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  'A traveller came along wrapped in a warm cloak.',
  'The birch canoe slid on the smooth planks.',
  'Glue the sheet to the dark blue background.',
  "It's easy to tell the depth of a well.",
  'These days a chicken leg is a rare dish.',
  'Rice is often served in round bowls.',
  'The juice of lemons makes fine punch.',
  'The box was thrown beside the parked truck.',
  'The hogs were fed chopped corn and garbage.',
  'Four hours of steady work faced us.',
  HEAVY,
];
const lengths = [12, 14, 16, 18];
const pitches = [100, 170, 250];
const median = (values) => {
  const v = [...values].sort((a, b) => a - b),
    m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const all = [],
  byLength = Object.fromEntries(lengths.map((L) => [L, []])),
  readings = Object.fromEntries(lengths.map((L) => [L, []])),
  cells = {};
for (const text of texts) {
  const ratios = [];
  for (const L of lengths) {
    for (const pitch of pitches) {
      const { samples } = synthesize(text, {
        head: { ...DEFAULT_HEAD, vocalTractLength: L, pitch },
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const f = stateFeatures(accumulate(emptyState(), samples, 16000));
      ratios.push(f.vocalTractLength / L);
      if (text !== HEAVY) {
        byLength[L].push(f.vocalTractLength / L);
        readings[L].push(f.vocalTractLength);
        (cells[`${L} ${pitch}`] ??= []).push(Math.log(f.vocalTractLength / L));
      }
    }
  }
  if (text !== HEAVY) {
    all.push(...ratios);
  }
  console.log(
    `${median(ratios).toFixed(4)} [${Math.min(...ratios).toFixed(3)}, ` +
      `${Math.max(...ratios).toFixed(3)}] ${JSON.stringify(text)}`
  );
}
const lnRatios = all.map(Math.log),
  mean = lnRatios.reduce((a, b) => a + b, 0) / lnRatios.length,
  sd = Math.sqrt(
    lnRatios.reduce((a, b) => a + (b - mean) ** 2, 0) / (lnRatios.length - 1)
  );
console.log(
  `without the heavy sentence: median ${median(all).toFixed(4)}, ` +
    `geometric mean ${Math.exp(mean).toFixed(4)}, sd of ln ${sd.toFixed(4)}`
);
for (const L of lengths) {
  console.log(
    `true ${L} cm: median ratio ${median(byLength[L]).toFixed(4)}, ` +
      `median reading ${median(readings[L]).toFixed(3)} cm`
  );
}
// Spread of one sentence's reading about the median of the texts at the
// same tract and pitch: the uncertainty a reading has when the words are
// unknown.
const deviations = Object.values(cells).flatMap((values) => {
  const m = median(values);
  return values.map((v) => Math.abs(v - m));
});
console.log(
  `text spread of ln reading (1.4826 MAD about each cell median): ` +
    `${(1.4826 * median(deviations)).toFixed(4)}`
);
