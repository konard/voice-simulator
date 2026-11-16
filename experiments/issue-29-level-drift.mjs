// Issue 29: how the level of one tier relative to another drifts over a
// sustained phone (25 ms windows), and how much a noise level moves from
// one 25 ms window to the next. Run: node experiments/issue-29-level-drift.mjs [js|rust]
import { createEngine } from '../src/engine/index.js';
import {
  db,
  rms,
  sustainedPlan,
  streamPlan,
  tierIndex,
} from '../tests/helpers/adaptive-stream.js';

const engine = await createEngine({ engine: process.argv[2] ?? 'js' });
const R = 48000;
const W = Math.round(0.025 * R);
for (const [ipa, a, b] of [
  ['aː', 'medium', 'high'],
  ['aː', 'low', 'minimal'],
  ['sː', 'low', 'minimal'],
  ['sː', 'medium', 'low'],
]) {
  const plan = sustainedPlan(ipa);
  const x = (await streamPlan(engine, plan, tierIndex(a))).samples;
  const y = (await streamPlan(engine, plan, tierIndex(b))).samples;
  const ratio = [];
  const jumps = [];
  for (let t = Math.round(0.15 * R); t + W <= Math.round(0.7 * R); t += W) {
    ratio.push(db(rms(y, t, t + W) / rms(x, t, t + W)));
    jumps.push(db(rms(x, t, t + W) / rms(x, t - W, t)));
  }
  const fmt = (v) => v.map((n) => n.toFixed(2)).join(' ');
  console.log(`${ipa} ${b}/${a} per 25 ms from 0.15 s: ${fmt(ratio)}`);
  console.log(
    `  ${a} window vs the one before: ${fmt(jumps)}; largest |jump| ${Math.max(...jumps.map(Math.abs)).toFixed(2)} dB`
  );
}
