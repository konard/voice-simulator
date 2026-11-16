import { synthesize } from '../src/index.js';
for (const tier of ['wideband', undefined]) {
  const t = performance.now();
  const opts = tier ? { tier } : { solver: 'waveguide', sampleRate: 16000 };
  const r = synthesize('Hello world.', opts);
  console.log(tier, performance.now() - t, r.sampleRate, r.duration);
}
const r = synthesize('Hello world.', { tier: 'wideband' });
console.log(r.plan.segments.map((s) => [s.kind, s.start.toFixed(3), s.duration.toFixed(3), s.token?.symbol ?? s.token?.base]));
