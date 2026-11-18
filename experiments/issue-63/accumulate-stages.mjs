// Unlicense. Issue 63: time of each stage of accumulate() on one fitVoice
// render of the voice-match test sentence (JavaScript engine).
// Usage: node accumulate-stages.mjs
import { performance } from 'node:perf_hooks';
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { prepareLegacyVoice } from '../../src/analysis/voice-features.js';
import {
  countNuclei,
  emptyNuclei,
} from '../../src/analysis/voice-fit-nuclei.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const { samples } = synthesize(TEXT, {
  head: DEFAULT_HEAD,
  seed: 1,
  sampleRate: 16000,
  solver: 'waveguide',
  lang: 'en',
  engine: 'js',
});
const input = Float32Array.from(samples);
const time = (label, fn, n = 3) => {
  const t0 = performance.now();
  let out;
  for (let i = 0; i < n; i++) {
    out = fn();
  }
  console.log(`${label}: ${((performance.now() - t0) / n).toFixed(1)} ms`);
  return out;
};
const frames = time('analyzeFrames', () =>
  analyzeFrames(input, 16000, { maxSeconds: 30 })
);
const pitch = time('trackPitch', () => trackPitch(frames));
time('trackFormants', () =>
  trackFormants(frames, { pitch, vocalTractLength: 16.5 })
);
time('inverseFilter', () => inverseFilter(frames, { pitch, trace: null }));
const analysis = time('prepareLegacyVoice', () =>
  prepareLegacyVoice(input, 16000, { diagnosticsOnly: true })
);
time(
  'legacy rateFeatures',
  () => prepareLegacyVoice(input, 16000, { diagnosticsOnly: true }).rateFeatures
);
time('legacy complete', () => analysis.complete(), 1);
time('countNuclei', () =>
  countNuclei({ nuclei: 0, landmarks: emptyNuclei() }, input, 16000, frames, {})
);
