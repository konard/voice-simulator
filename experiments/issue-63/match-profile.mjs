// Unlicense. Issue 63: one legacy matchVoice call (default 4 rounds, 40
// renders) on the voice-match test sentence, for CPU profiling.
// Usage: node --cpu-prof --cpu-prof-dir=DIR match-profile.mjs [rounds]
import { performance } from 'node:perf_hooks';
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import { matchVoice } from '../../src/analysis/voice-match.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const { samples, sampleRate } = synthesize(TEXT, {
  head: { ...DEFAULT_HEAD, pitch: 210, vocalTractLength: 14 },
  seed: 1,
  sampleRate: 16000,
  solver: 'waveguide',
  lang: 'en',
  engine: 'js',
});
const t0 = performance.now();
const result = matchVoice(samples, sampleRate, {
  iterations: Number(process.argv[2] ?? 4),
  engine: 'js',
});
console.log(
  `matchVoice ${((performance.now() - t0) / 1000).toFixed(2)} s distance ${result.distance}`
);
console.log(JSON.stringify(result.head));
