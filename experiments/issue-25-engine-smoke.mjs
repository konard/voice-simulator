// Smoke test of the engine choice of issue 25: renders "Hello." with each
// engine and prints the largest difference and the timings.
import { synthesize } from '../src/index.js';
import { getEngine as get } from '../src/engine/index.js';

const engine = get();
console.log('auto engine:', engine.name, engine.simd, engine.reason);
for (const tier of ['minimal', undefined]) {
  const t0 = globalThis.performance.now();
  const rust = synthesize('Hello.', { tier, seed: 1, engine: 'rust' });
  const t1 = globalThis.performance.now();
  const js = synthesize('Hello.', { tier, seed: 1, engine: 'js' });
  const t2 = globalThis.performance.now();
  let max = 0;
  for (let i = 0; i < js.samples.length; i++) {
    max = Math.max(max, Math.abs(js.samples[i] - rust.samples[i]));
  }
  console.log(
    tier ?? 'default',
    js.samples.length,
    rust.samples.length,
    'max diff',
    max,
    `rust ${(t1 - t0).toFixed(0)} ms js ${(t2 - t1).toFixed(0)} ms`
  );
}
