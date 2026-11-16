// Diagnosis of voicing errors and fine f0 bias of trackPitch on one voice.
// Run: node experiments/issue-59-diagnose.mjs male 16000 [shift]
import { synthesize } from '../src/synthesize.js';
import { presetHeadConfig } from '../src/head-config.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { plannedPitch } from '../tests/helpers/recognition-truth.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const [preset = 'male', rateText = '16000', verbose = ''] =
  process.argv.slice(2);
const out = synthesize(TEXT, {
  head: presetHeadConfig(preset),
  solver: 'waveguide',
  sampleRate: Number(rateText),
  seed: 1,
});
const frames = analyzeFrames(out.samples, out.sampleRate);
const track = trackPitch(frames);
const truth = plannedPitch(out.plan, frames.hop, track.count);
// Signed fine error for time shifts of the truth.
for (const shift of [-4, -2, -1, 0, 1, 2, 4]) {
  let sum = 0,
    abs = 0,
    n = 0;
  for (let t = 0; t < track.count; t++) {
    const s = t + shift;
    if (s < 0 || s >= track.count || !truth.mask[t]) {
      continue;
    }
    const r = truth.f0[s],
      e = track.f0[t];
    if (r > 0 && e > 0 && Math.abs(e / r - 1) < 0.2) {
      const c = 1200 * Math.log2(e / r);
      sum += c;
      abs += Math.abs(c);
      n++;
    }
  }
  console.log(
    `shift ${shift}: mean ${(sum / n).toFixed(1)} abs ${(abs / n).toFixed(1)}`
  );
}
let missed = 0,
  extra = 0;
const state = {};
for (let t = 0; t < track.count; t++) {
  if (!truth.mask[t]) {
    continue;
  }
  const r = truth.f0[t] > 0,
    e = track.f0[t] > 0;
  if (r !== e) {
    if (r) {
      missed++;
    } else {
      extra++;
    }
    if (verbose) {
      sampleState(out.plan, t * frames.hop, state);
      console.log(
        t,
        (t * frames.hop).toFixed(3),
        r ? 'missed' : 'extra',
        `v=${state.voicing.toFixed(2)} l=${state.loudness.toFixed(2)} f0=${state.f0.toFixed(0)}`,
        `est=${track.f0[t].toFixed(0)} voicing=${track.voicing[t].toFixed(2)} h=${track.strength[t].toFixed(2)}`,
        `E=${frames.energy[t].toFixed(1)} N=${frames.noise[t].toFixed(1)}`
      );
    }
  }
}
console.log({ missed, extra });
