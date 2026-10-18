// How the voice features respond to one head parameter at a time.
// Usage: node experiments/issue-5-voice-sensitivity.mjs [preset]
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const base = presetHeadConfig(process.argv[2] ?? 'female');
const sweeps = {
  tenseness: [0.3, 0.5, 0.7, 0.9],
  breathiness: [0.05, 0.25, 0.5, 0.8],
  aspirationLevel: [0.5, 1, 2],
  pitchRange: [1, 3, 6],
  speechRate: [0.8, 1, 1.25],
  vocalTractLength: [13, 15, 17],
};
for (const [key, values] of Object.entries(sweeps)) {
  for (const value of values) {
    const { samples, sampleRate } = synthesize(
      'The north wind and the sun were disputing.',
      {
        head: { ...base, [key]: value },
        sampleRate: 16000,
        solver: 'waveguide',
      }
    );
    const f = analyzeVoice(samples, sampleRate);
    console.log(
      `${key}=${value}`.padEnd(22),
      `f0 ${f.f0.toFixed(0)} range ${f.f0Range.toFixed(1)}`,
      `vtl ${f.vocalTractLength.toFixed(2)} h1h2 ${f.h1h2.toFixed(1)}`,
      `hnr ${f.hnr.toFixed(1)} rate ${f.syllableRate.toFixed(2)}`,
      `active ${f.activeDuration.toFixed(2)} voiced ${f.voicedDuration.toFixed(2)}`
    );
  }
}
