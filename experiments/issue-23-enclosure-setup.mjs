// Issue 23: where the time of a short render in a 40 cm room goes (model
// build, JavaScript renderer, Rust renderer), to size the enclosure case of
// tests/rust-fdtd.test.js.
//   node experiments/issue-23-enclosure-setup.mjs [samples]
import { VoiceRenderer } from '../src/acoustics/voice.js';
import {
  RustVoiceRenderer,
  rendererModel,
} from '../src/engine/rust-renderer.js';
import { loadEngineModule } from '../src/engine/wasm-loader.js';
import { prepareUtterance } from '../src/synthesize.js';

const samples = Number(process.argv[2] ?? 2400);
const now = () => globalThis.performance.now();
const { plan, renderOptions } = prepareUtterance('Hello.', {
  tier: 'high',
  seed: 1,
});
const options = {
  ...renderOptions,
  enclosure: { width: 40, height: 40, depth: 40 },
};
let start = now();
const model = rendererModel(plan.head, options);
console.log(
  `model: ${model.cells.length} cells, ${(now() - start).toFixed(0)} ms`
);
start = now();
const js = new VoiceRenderer(plan, options);
console.log(`JS renderer: ${(now() - start).toFixed(0)} ms`);
start = now();
js.render(new Float32Array(samples));
console.log(`JS ${samples} samples: ${(now() - start).toFixed(0)} ms`);
const engine = await loadEngineModule(undefined, { simd: false });
start = now();
const rust = new RustVoiceRenderer(engine, plan, options);
console.log(`Rust renderer: ${(now() - start).toFixed(0)} ms`);
start = now();
rust.render(new Float32Array(samples));
console.log(`Rust ${samples} samples: ${(now() - start).toFixed(0)} ms`);
rust.free();
