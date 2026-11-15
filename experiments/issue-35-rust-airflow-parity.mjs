// Relative RMS error of the Rust Aerodynamics (vs_aero_run) against
// src/acoustics/aerodynamics.js over the closure and release of
// tests/rust-parity.test.js, and the number of bit-identical values.
// Needs src/engine/voice-simulator.wasm (npm run build:wasm).
// Usage: node experiments/issue-35-rust-airflow-parity.mjs
import { Aerodynamics } from '../src/acoustics/aerodynamics.js';
import { float64View, loadEngineModule } from '../src/engine/wasm-loader.js';

const engine = await loadEngineModule();
if (!engine) {
  throw new Error('no Rust engine; run npm run build:wasm');
}
const count = 9600;
const dt = 1 / 48000;
const inputs = Array.from({ length: count }, (_, index) => {
  const time = index * dt;
  const closed = time > 0.05 && time < 0.1;
  return [
    Math.min(8000, time * 160000),
    0.05 + 0.2 * Math.min(1, Math.max(0, (time - 0.04) / 0.05)),
    closed ? 0 : 0.09 + 0.5 * Math.max(0, time - 0.1),
  ];
});
const pointer = engine.exports.vs_alloc(count * 40);
const steps = float64View(engine, pointer, count * 5);
inputs.forEach((row, index) => steps.set(row, index * 5));
engine.exports.vs_aero_run(dt, 1e-3, pointer, count);
const actual = float64View(engine, pointer, count * 5);
const air = new Aerodynamics();
let error = 0;
let energy = 0;
let identical = 0;
inputs.forEach(([lung, glottis, constriction], index) => {
  const state = air.step(dt, lung, glottis, constriction);
  [
    state.flow,
    state.flowDerivative,
    state.oralPressure,
    state.glottalDrop,
    state.constrictionDrop,
  ].forEach((value, offset) => {
    const other = actual[index * 5 + offset];
    identical += Object.is(other, value) ? 1 : 0;
    error += (other - value) ** 2;
    energy += value ** 2;
  });
});
console.log(
  `relative RMS error ${Math.sqrt(error / energy).toExponential(2)}, ` +
    `${identical} of ${count * 5} values bit-identical`
);
