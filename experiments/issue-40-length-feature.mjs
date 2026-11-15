#!/usr/bin/env node
// Issue 40: the tract length that analyzeVoice reads from the formant
// spacing of F1 to F4 (vocalTractLength) and of F1 to F3 only, for the
// people that matchVoice renders (preset proportions at the size that fits
// the length) saying its calibration sentence at 16000 Hz.
//
// Usage: node experiments/issue-40-length-feature.mjs [root of a checkout]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(`${root}/src/${path}`).href);
const { synthesize, analyzeVoice, presetHeadConfig } = await load('index.js');
const { formantSpacing } = await load('analysis/voice-features.js');
const { MATCH_TEXT } = await load('analysis/voice-match.js');
const { SPEED_OF_SOUND } = await load('acoustics/transfer.js');

const lowerLength = (formants) =>
  SPEED_OF_SOUND / (2 * formantSpacing(formants.slice(0, 3)));

const PEOPLE = { child: [12.6, 15], female: [13.6, 16.8], male: [15.4, 18.6] };
for (const [preset, [from, to]] of Object.entries(PEOPLE)) {
  const rows = [];
  for (let size = 0; size <= 1.0001; size += 0.25) {
    const person = presetHeadConfig(preset, size);
    for (const length of [from, (from + to) / 2, to]) {
      const head = { ...person, vocalTractLength: length };
      const { samples, sampleRate } = synthesize(MATCH_TEXT, {
        head,
        lang: 'en',
        sampleRate: 16000,
        solver: 'waveguide',
        seed: 1,
      });
      const features = analyzeVoice(samples, sampleRate);
      rows.push(
        `${preset} size ${size.toFixed(2)} length ${length.toFixed(1)}: ` +
          `F1-F4 ${features.vocalTractLength.toFixed(2)} ` +
          `F1-F3 ${lowerLength(features.formants).toFixed(2)}`
      );
    }
  }
  console.log(rows.join('\n'));
}
