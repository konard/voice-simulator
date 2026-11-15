// Compares renderPlan and renderPlanRust with listeners (issue 22):
// node experiments/issue-22-listener-parity.mjs (needs npm run build:wasm).
import { renderPlan } from '../src/acoustics/voice.js';
import { renderPlanRust } from '../src/engine/rust-renderer.js';
import { loadRustEngine } from '../tests/helpers/rust-engine.js';
import { prepareUtterance } from '../src/synthesize.js';

const engine = await loadRustEngine();
const { plan, renderOptions } = prepareUtterance('Hello world.', {
  tier: 'minimal',
  seed: 1,
});
for (const extra of [
  { microphone: { distance: 100, azimuth: 150, elevation: 20 } },
  { microphone: { distance: 50, compensate: true }, room: 'cathedral' },
  { enclosure: { width: 60, height: 60, depth: 60, absorption: 0.2 } },
  { enclosure: { width: 60, height: 60, depth: 60 }, room: 'bathroom' },
]) {
  const options = { ...renderOptions, ...extra };
  const expected = renderPlan(plan, options);
  const actual = renderPlanRust(engine, plan, options);
  let max = 0;
  for (let index = 0; index < expected.length; index++) {
    max = Math.max(max, Math.abs(actual[index] - expected[index]));
  }
  globalThis.console.log(
    JSON.stringify(extra),
    expected.length === actual.length,
    `max abs diff ${max}`
  );
}
