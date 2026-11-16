// Cost of trackPitch as a share of real time (one core), after one warm-up
// run, for the male sentence at 16000 and 8000 Hz; the median of five runs.
// Run: node experiments/issue-59-rtf.mjs
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/synthesize.js';
import { presetHeadConfig } from '../src/head-config.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';

const TEXT = 'The north wind and the sun were disputing which was the stronger.';
for (const sampleRate of [16000, 8000]) {
  const out = synthesize(TEXT, {
    head: presetHeadConfig('male'),
    solver: 'waveguide',
    sampleRate,
    seed: 1,
  });
  const frames = analyzeFrames(out.samples, out.sampleRate);
  trackPitch(frames);
  const times = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    trackPitch(frames);
    times.push((performance.now() - started) / 1000);
  }
  times.sort((a, b) => a - b);
  console.log(
    `pitch rtf @${sampleRate}: median ${(times[2] / out.duration).toFixed(4)}, ` +
      `min ${(times[0] / out.duration).toFixed(4)}, ` +
      `max ${(times[4] / out.duration).toFixed(4)} (${out.duration.toFixed(2)} s)`
  );
}
