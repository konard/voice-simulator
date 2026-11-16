// Issue 29: where the level of a noise switch goes (sː, low to minimal).
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
const ms = (x) => Math.round((x / 1000) * R);
for (const [ipa, from, to] of [
  ['sː', 'low', 'minimal'],
  ['sː', 'medium', 'high'],
  ['aː', 'medium', 'high'],
]) {
  const plan = sustainedPlan(ipa);
  const a = (await streamPlan(engine, plan, tierIndex(from))).samples;
  const b = (await streamPlan(engine, plan, tierIndex(to))).samples;
  const sw = await streamPlan(engine, plan, tierIndex(from), {
    requests: [{ time: 0.3, level: tierIndex(to) }],
  });
  const s = sw.stream.switches[0];
  const fade = Math.round(s.at * R) + ms(30);
  const line = [];
  for (let t = fade - ms(50); t < fade + ms(75); t += ms(12.5)) {
    line.push(
      `${(((t - fade) / R) * 1000).toFixed(1)}:${db(rms(a, t, t + ms(12.5))).toFixed(2)}/${db(rms(b, t, t + ms(12.5))).toFixed(2)}/${db(rms(sw.samples, t, t + ms(12.5))).toFixed(2)}`
    );
  }
  console.log(
    ipa,
    from,
    to,
    'gainDb',
    s.gainDb.toFixed(3),
    'r',
    s.r.toFixed(3)
  );
  console.log(
    `  t(ms from fade): plainOld/plainNew/switched dB per 12.5 ms\n  ${line.join(
      '\n  '
    )}`
  );
  console.log(
    '  plain old vs new over 0.4-0.6 s:',
    db(rms(b, ms(400), ms(600)) / rms(a, ms(400), ms(600))).toFixed(3),
    'dB'
  );
}
