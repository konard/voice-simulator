// Since #25 (Rust engine as the default) renderPlan(plan, renderOptions)
// with the options of prepareUtterance renders with the Rust engine, so a
// parity test that takes it as the JavaScript reference compares Rust with
// Rust. This prints the difference of the Rust render to renderPlan with
// the default engine and to renderPlan with engine 'js'.
// Usage: REQUIRE_WASM=1 node experiments/issue-52-parity-reference.mjs
import { renderPlan } from '../src/acoustics/voice.js';
import { renderPlanRust } from '../src/engine/rust-renderer.js';
import { prepareUtterance } from '../src/synthesize.js';
import { loadRustEngine } from '../tests/helpers/rust-engine.js';

const engine = await loadRustEngine();
const { plan, renderOptions } = prepareUtterance(
  '[soft]Hello[/soft] [crescendo]there, my[/crescendo] [shout]friend![/shout]',
  { tier: 'minimal', seed: 1, markup: true }
);
const rust = renderPlanRust(engine, plan, renderOptions);
const largest = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
};
console.log(
  'default engine:',
  largest(rust, renderPlan(plan, renderOptions)),
  "engine 'js':",
  largest(rust, renderPlan(plan, { ...renderOptions, engine: 'js' }))
);
