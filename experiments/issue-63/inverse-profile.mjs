// Unlicense. Issue 63: inverseFilter on one fitVoice render, repeated, for
// CPU profiling; prints a checksum of its outputs to compare optimisations.
// Usage: node [--cpu-prof --cpu-prof-dir=DIR] inverse-profile.mjs [repeats]
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
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
const frames = analyzeFrames(Float32Array.from(samples), 16000, {
  maxSeconds: 30,
});
const pitch = trackPitch(frames);
const repeats = Number(process.argv[2] ?? 5);
let source;
const t0 = performance.now();
for (let i = 0; i < repeats; i++) {
  source = inverseFilter(frames, { pitch, trace: null });
}
console.log(
  `inverseFilter ${((performance.now() - t0) / repeats).toFixed(1)} ms`
);
const hash = createHash('sha256');
for (const [key, value] of Object.entries(source)) {
  if (ArrayBuffer.isView(value)) {
    hash
      .update(key)
      .update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  } else {
    hash.update(key).update(JSON.stringify(value) ?? '');
  }
}
console.log(`checksum ${hash.digest('hex')}`);
