// Compare formant-spacing estimators of the tract length on preset voices.
// Usage: node experiments/issue-5-voice-spacing.mjs [analysisRate] [order]
import { synthesize } from '../src/synthesize.js';
import {
  analyzeVoice,
  formantSpacing,
} from '../src/analysis/voice-features.js';
import { presetHeadConfig, randomHeadConfig } from '../src/head-config.js';

const texts = [
  'The north wind and the sun were disputing.',
  'Please call Stella and ask her to bring these things.',
];
const analysisRate = Number(process.argv[2] ?? 11025);
const order = process.argv[3] ? Number(process.argv[3]) : undefined;
const length = (spacing) => (35000 / (2 * spacing)).toFixed(2);
for (const preset of ['male', 'female', 'child']) {
  for (const seed of [0, 1, 2, 3]) {
    const head =
      seed === 0
        ? presetHeadConfig(preset)
        : randomHeadConfig(seed, { preset });
    const row = [
      `${preset} ${seed}`.padEnd(10),
      `VTL ${head.vocalTractLength}`,
    ];
    for (const text of texts) {
      const { samples, sampleRate } = synthesize(text, {
        head,
        sampleRate: 22050,
        solver: 'waveguide',
      });
      const features = analyzeVoice(samples, sampleRate, {
        analysisRate,
        order,
      });
      row.push(
        `frame ${features.vocalTractLength.toFixed(2)}`,
        `med4 ${length(formantSpacing(features.formants))}`,
        `med3 ${length(formantSpacing(features.formants.slice(0, 3)))}`
      );
    }
    console.log(row.join(' '));
  }
}
