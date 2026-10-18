// Does the measured syllable rate follow the head's speechRate?
// Usage: node experiments/issue-5-syllable-rate.mjs
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const texts = [
  'The north wind and the sun were disputing which was the stronger.',
  'Please call Stella and ask her to bring these things with her.',
];
for (const preset of ['male', 'female']) {
  for (const text of texts) {
    const row = [preset, text.slice(0, 12)];
    for (const speechRate of [0.7, 1, 1.4, 1.8]) {
      const head = { ...presetHeadConfig(preset), speechRate };
      const { samples, sampleRate } = synthesize(text, {
        head,
        sampleRate: 16000,
        solver: 'waveguide',
      });
      const f = analyzeVoice(samples, sampleRate);
      row.push(
        `${speechRate}: n=${(f.syllableRate * f.activeDuration).toFixed(0)}`,
        `rate=${f.syllableRate.toFixed(2)} active=${f.activeDuration.toFixed(2)}`
      );
    }
    console.log(row.join(' '));
  }
}
