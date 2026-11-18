// Unlicense. Issue 63: landmark syllable rate / DEFAULT_SYLLABLE_RATE (the
// stage A speechRate without a transcript before TEXT_SYLLABLE_RATIO) of the
// default head at rate 1 for several texts. The median of the texts other
// than the heavy test sentence is TEXT_SYLLABLE_RATIO.
// Usage: node syllable-rate-texts.mjs
import { fitVoice, synthesize, DEFAULT_HEAD } from '../../src/index.js';
import {
  MATCH_TEXT,
  DEFAULT_SYLLABLE_RATE,
} from '../../src/analysis/voice-fit-calibration.js';
const texts = [
  MATCH_TEXT,
  'The north wind and the sun were disputing which was the stronger.',
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  'A traveller came along wrapped in a warm cloak.',
  // Harvard sentences (IEEE 1969, list 1), as in tract-texts.mjs.
  'The birch canoe slid on the smooth planks.',
  'Glue the sheet to the dark blue background.',
  "It's easy to tell the depth of a well.",
  'These days a chicken leg is a rare dish.',
  'Rice is often served in round bowls.',
  'The juice of lemons makes fine punch.',
  'The box was thrown beside the parked truck.',
  'The hogs were fed chopped corn and garbage.',
  'Four hours of steady work faced us.',
];
const HEAVY = texts[1],
  readings = [];
for (const text of texts) {
  const { samples, sampleRate } = synthesize(text, {
    head: DEFAULT_HEAD,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const fit = fitVoice(samples, sampleRate, { refine: false }),
    ratio = fit.features.syllableRate / DEFAULT_SYLLABLE_RATE;
  if (text !== HEAVY) {
    readings.push(ratio);
  }
  console.log(ratio.toFixed(3), JSON.stringify(text));
}
readings.sort((a, b) => a - b);
const m = readings.length >> 1;
console.log(
  `median without the heavy sentence: ${(readings.length % 2 ? readings[m] : (readings[m - 1] + readings[m]) / 2).toFixed(4)}`
);
