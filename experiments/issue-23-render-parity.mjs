/**
 * Issue 23: the Rust renderer with the 3D FDTD solver against VoiceRenderer
 * with `solver: 'fdtd3d'`, on 'Hello.', seed 1, tier high, as well as with a
 * 40 cm enclosure and with `teeth: false`. Prints the largest absolute
 * sample difference and the time of each renderer.
 *
 *   node experiments/issue-23-render-parity.mjs [text] [tier]
 *
 * Needs src/engine/voice-simulator.wasm (npm run build:wasm).
 */
import { renderPlan } from '../src/acoustics/voice.js';
import { renderPlanRust } from '../src/engine/rust-renderer.js';
import { loadEngineModule } from '../src/engine/wasm-loader.js';
import { prepareUtterance } from '../src/synthesize.js';

const text = process.argv[2] ?? 'Hello.';
const tier = process.argv[3] ?? 'high';
const engine = await loadEngineModule(undefined, { simd: false });
const { plan, renderOptions } = prepareUtterance(text, { tier, seed: 1 });
console.log(`solver ${renderOptions.solver}, dx ${renderOptions.dx}`);

for (const [name, extra] of [
  ['default', {}],
  ['enclosure 40', { enclosure: { width: 40, height: 40, depth: 40 } }],
  ['teeth false', { teeth: false }],
]) {
  const options = { ...renderOptions, ...extra, kernel: 'wasm' };
  let started = globalThis.performance.now();
  const js = renderPlan(plan, options);
  const jsSeconds = (globalThis.performance.now() - started) / 1000;
  started = globalThis.performance.now();
  const rust = renderPlanRust(engine, plan, options);
  const rustSeconds = (globalThis.performance.now() - started) / 1000;
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < js.length; i++) {
    worst = Math.max(worst, Math.abs(js[i] - rust[i]));
    peak = Math.max(peak, Math.abs(js[i]));
  }
  console.log(
    `${name}: ${js.length} / ${rust.length} samples, max |diff| ${worst.toExponential(3)}, peak ${peak.toFixed(4)}, js ${jsSeconds.toFixed(2)} s, rust ${rustSeconds.toFixed(2)} s`
  );
}
