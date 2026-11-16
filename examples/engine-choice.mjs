// The engine choice of issue 25: Rust by default, JavaScript as the
// fallback. Run: node examples/engine-choice.mjs
import { createEngine, prepareUtterance, synthesize } from '../src/index.js';

const engine = await createEngine();
console.log(
  'engine',
  engine.name,
  'simd',
  engine.simd,
  'reason',
  engine.reason
);
const { samples } = synthesize('Hello.', { engine, tier: 'minimal' });
const js = synthesize('Hello.', { engine: 'js', tier: 'minimal' }).samples;
let diff = 0;
for (let i = 0; i < samples.length; i++) {
  diff = Math.max(diff, Math.abs(samples[i] - js[i]));
}
console.log('samples', samples.length, 'max |rust - js|', diff);
const { plan, renderOptions } = prepareUtterance('Hello.', { tier: 'minimal' });
const renderer = engine.createRenderer(plan, renderOptions);
console.log('renderer', renderer.engine, renderer.fallbackReason);
renderer.free?.();
