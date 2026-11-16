// Issue 29: level, correlation and pitch phase around a tier switch.
// Run: node experiments/issue-29-switch-levels.mjs [js|rust]
import { createEngine } from '../src/engine/index.js';
import {
  bestCorrelation,
  db,
  largestStep,
  rms,
  sustainedPlan,
  streamPlan,
  tierIndex,
} from '../tests/helpers/adaptive-stream.js';

const engine = await createEngine({ engine: process.argv[2] ?? 'js' });
const RATE = 48000;
const at = (s) => Math.round(s * RATE);

async function pair(ipa, from, to) {
  const plan = sustainedPlan(ipa);
  const plain = await streamPlan(engine, plan, tierIndex(from));
  const started = globalThis.performance.now();
  const switched = await streamPlan(engine, plan, tierIndex(from), {
    requests: [{ time: 0.3, level: tierIndex(to) }],
  });
  const ms = globalThis.performance.now() - started;
  const target = await streamPlan(engine, plan, tierIndex(to));
  const s = switched.stream.switches[0];
  let worst = 0;
  for (let t = at(0.25); t + at(0.005) <= at(0.45); t += at(0.005)) {
    const d = db(
      rms(switched.samples, t, t + at(0.005)) /
        rms(plain.samples, t, t + at(0.005))
    );
    if (Math.abs(d) > Math.abs(worst)) {
      worst = d;
    }
  }
  const fadeStart = Math.round(s.at * RATE) + at(0.03);
  const overlap = db(
    rms(switched.samples, fadeStart, fadeStart + at(0.025)) /
      rms(switched.samples, fadeStart - at(0.025), fadeStart)
  );
  const plainOverlap = db(
    rms(plain.samples, fadeStart, fadeStart + at(0.025)) /
      rms(plain.samples, fadeStart - at(0.025), fadeStart)
  );
  const step =
    largestStep(switched.samples, at(0.25), at(0.45)) /
    largestStep(plain.samples, at(0.25), at(0.45));
  const pitch = bestCorrelation(
    switched.samples,
    target.samples,
    at(0.5),
    at(0.6),
    24
  );
  const level = db(
    rms(switched.samples, at(0.4), at(0.6)) /
      rms(plain.samples, at(0.4), at(0.6))
  );
  console.log(
    `${ipa} ${from}->${to}: at=${s.at} r=${s.r.toFixed(4)} gainDb=${s.gainDb.toFixed(3)} ` +
      `worst5ms=${worst.toFixed(3)} dB overlapVsBefore=${overlap.toFixed(3)} dB (plain ${plainOverlap.toFixed(3)}) ` +
      `stepRatio=${step.toFixed(3)} pitchCorr=${pitch.correlation.toFixed(4)} lag=${pitch.lag} ` +
      `level0.4-0.6=${level.toFixed(3)} dB (${ms.toFixed(0)} ms)`
  );
}

console.log(`engine ${engine.name ?? process.argv[2] ?? 'js'}`);
await pair('aː', 'low', 'minimal');
await pair('aː', 'medium', 'high');
await pair('sː', 'medium', 'low');
await pair('sː', 'low', 'minimal');
await pair('sː', 'medium', 'high');
