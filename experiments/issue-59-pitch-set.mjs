// Pitch errors of trackPitch on "the set" of issue 59 (male, female, child
// at 16000 and 8000 Hz) against the planned f0, frames within 15 ms of a
// voicing change left out.
// Run: node experiments/issue-59-pitch-set.mjs
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/synthesize.js';
import { presetHeadConfig } from '../src/head-config.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { f0Errors } from '../src/metrics/pitch.js';
import {
  plannedPitch,
  maskedPair,
} from '../tests/helpers/recognition-truth.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, Number(value)];
  })
);
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const out = synthesize(TEXT, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate,
      seed: 1,
    });
    const frames = analyzeFrames(out.samples, out.sampleRate);
    const started = performance.now();
    const track = trackPitch(frames, options);
    const elapsed = (performance.now() - started) / 1000;
    const truth = plannedPitch(out.plan, frames.hop, track.count);
    const [r, t] = maskedPair(
      truth.f0,
      track.f0.subarray(0, track.count),
      truth.mask
    );
    const e = f0Errors(r, t);
    let fine = 0;
    let fineCount = 0;
    for (let i = 0; i < r.length; i++) {
      if (r[i] > 0 && t[i] > 0 && Math.abs(t[i] / r[i] - 1) <= 0.2) {
        fine += Math.abs(1200 * Math.log2(t[i] / r[i]));
        fineCount++;
      }
    }
    console.log(
      `${preset}@${sampleRate}`,
      JSON.stringify({
        frames: r.length,
        gpe: +e.gpe.toFixed(4),
        vde: +e.vde.toFixed(4),
        ffe: +e.ffe.toFixed(4),
        fineCents: +(fine / fineCount).toFixed(1),
        median: +track.median.toFixed(1),
        jitter: track.jitter && +track.jitter.toFixed(2),
        shimmer: track.shimmer && +track.shimmer.toFixed(2),
        rtf: +(elapsed / out.duration).toFixed(4),
      })
    );
  }
}
