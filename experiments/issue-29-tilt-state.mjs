// Does a Glottis that restores another one's saved state continue with the
// same samples when `effort` is not 0 (the spectral tilt filter of issue 35
// keeps three samples of memory)? Prints the samples that differ and the
// largest difference relative to the peak after the hand-over.
// Usage: node experiments/issue-29-tilt-state.mjs
import { Glottis } from '../src/acoustics/glottis.js';

const DT = 1 / 48000;
const OPTIONS = { seed: 7, chink: 2 };
const control = (n, effort) => ({
  f0: 110 + 20 * Math.sin(n / 4000),
  voicing: 1,
  aspiration: 0,
  closure: 0,
  loudness: 1,
  effort,
});
const noise = (n) => Math.sin(n * 12.9898) - Math.sin(n * 78.233);
const run = (glottis, from, to, effort) => {
  const out = [];
  for (let n = from; n < to; n++) {
    out.push(glottis.step(DT, control(n, effort), noise(n)));
  }
  return out;
};

for (const effort of [0, 6, -6]) {
  const at = 5003;
  const whole = new Glottis(OPTIONS);
  const first = new Glottis(OPTIONS);
  run(whole, 0, at, effort);
  run(first, 0, at, effort);
  const second = new Glottis({ ...OPTIONS, seed: 99 });
  second.restoreState(first.saveState());
  const a = run(whole, at, 12000, effort);
  const b = run(second, at, 12000, effort);
  let different = 0;
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      different++;
    }
    worst = Math.max(worst, Math.abs(a[i] - b[i]));
    peak = Math.max(peak, Math.abs(a[i]));
  }
  console.log(
    `effort ${effort} dB: ${different} of ${a.length} samples differ, worst ${(worst / peak).toExponential(2)} of the peak`
  );
}
