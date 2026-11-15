/**
 * Issue 27: how far the Rust resampler (src/engine/voice-simulator.wasm)
 * is from src/audio/resample.js. Prints, per rate pair, the relative RMS
 * error and the share of output samples whose bits differ.
 *
 *   npm run build:wasm && node experiments/issue-27-resample-parity.mjs
 */

import { createRandom } from '../src/random.js';
import { resample } from '../src/audio/resample.js';
import { float32View, loadEngineModule } from '../src/engine/wasm-loader.js';

const engine = await loadEngineModule();
if (!engine) {
  throw new Error('no engine: run npm run build:wasm');
}
const { exports } = engine;

function signal(rate) {
  const random = createRandom(`issue-27-${rate}`);
  return Float32Array.from(
    { length: Math.round(rate / 2) },
    (_, index) =>
      0.4 * Math.sin((2 * Math.PI * 440 * index) / rate) +
      0.2 * Math.sin((2 * Math.PI * 3100 * index) / rate) +
      0.2 * (random() - 0.5)
  );
}

function inEngine(samples, from, to, zeroCrossings) {
  const length = exports.vs_resample_length(samples.length, from, to);
  const input = exports.vs_alloc(samples.length * 4);
  const output = exports.vs_alloc(length * 4);
  float32View(engine, input, samples.length).set(samples);
  const code = exports.vs_resample(
    input,
    samples.length,
    from,
    to,
    zeroCrossings,
    output,
    length
  );
  const result = float32View(engine, output, length).slice();
  exports.vs_free(input, samples.length * 4);
  exports.vs_free(output, length * 4);
  if (code !== 0) {
    throw new Error(`vs_resample: ${code}`);
  }
  return result;
}

for (const [from, to] of [
  [16000, 44100],
  [16000, 48000],
  [22050, 48000],
  [24000, 44100],
  [48000, 44100],
  [44100, 16000],
]) {
  for (const zeroCrossings of [8, 16]) {
    const input = signal(from);
    const expected = resample(input, from, to, { zeroCrossings });
    const actual = inEngine(input, from, to, zeroCrossings);
    let error = 0;
    let energy = 0;
    let differ = 0;
    for (let index = 0; index < expected.length; index++) {
      error += (actual[index] - expected[index]) ** 2;
      energy += expected[index] ** 2;
      differ += Object.is(actual[index], expected[index]) ? 0 : 1;
    }
    console.log(
      `${from} -> ${to} zc ${zeroCrossings}: relative RMS ${Math.sqrt(error / energy).toExponential(2)}, ` +
        `${differ} of ${expected.length} samples differ in bits`
    );
  }
}
