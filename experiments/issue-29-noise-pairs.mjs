// Issue 29: `sː` switched at 0.3 s between every pair of waveguide tiers
// of 22050 Hz and more: RMS of the overlap against the 25 ms before it,
// with the switch and in the plain render of the old tier (the window to
// window movement of the noise itself), and r.
// Run: node experiments/issue-29-noise-pairs.mjs [js|rust]
import { createEngine } from '../src/engine/index.js';
import {
  db,
  rms,
  streamPlan,
  sustainedPlan,
  tierIndex,
} from '../tests/helpers/adaptive-stream.js';

const engine = await createEngine({ engine: process.argv[2] ?? 'js' });
const R = 48000;
const N = Math.round(0.025 * R);
const plan = sustainedPlan('sː');
const names = ['minimal', 'low', 'medium'];
for (const from of names) {
  const plain = (await streamPlan(engine, plan, tierIndex(from))).samples;
  for (const to of names) {
    if (to === from) {
      continue;
    }
    const { samples, stream } = await streamPlan(
      engine,
      plan,
      tierIndex(from),
      {
        requests: [{ time: 0.3, level: tierIndex(to) }],
      }
    );
    const s = stream.switches[0];
    const fade = Math.round(s.at * R) + Math.round(0.03 * R);
    const switched = db(
      rms(samples, fade, fade + N) / rms(samples, fade - N, fade)
    );
    const own = db(rms(plain, fade, fade + N) / rms(plain, fade - N, fade));
    console.log(
      `${from} -> ${to}: at ${s.at} overlap vs before ${switched.toFixed(3)} dB ` +
        `(plain ${from}: ${own.toFixed(3)} dB) r ${s.r.toFixed(3)} gainDb ${s.gainDb.toFixed(3)}`
    );
  }
}
