/** Compare two scalar builds on a private, validated FDTD grid.
 * Run with node --max-old-space-size=256 --stack-size=512 and two wasm files.
 * Fixed studio-tier geometry, 100,000 warm-up steps, then five 10,000-step runs.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { loadEngineModule } from '../src/engine/wasm-loader.js';
import { RustVoiceRenderer } from '../src/engine/rust-renderer.js';
import { prepareUtterance } from '../src/synthesize.js';

const files = process.argv.slice(2);
if (files.length !== 2) {
  throw new Error('Provide the previous and proposed scalar wasm builds');
}
const { plan, renderOptions } = prepareUtterance('A short test.', {
  tier: 'studio',
  seed: 82,
});
const variants = [];
try {
  for (const file of files) {
    const module = await loadEngineModule(pathToFileURL(file), { simd: false });
    if (!module) {
      throw new Error(`Cannot load ${file}`);
    }
    const renderer = new RustVoiceRenderer(module, plan, renderOptions);
    variants.push({ file, module, renderer, times: [] });
    renderer.render(new Float32Array(480));
  }
  for (let round = 0; round < 15; round++) {
    for (const variant of variants) {
      const start = performance.now();
      const result = variant.module.exports.vs_renderer_kernel_steps(
        variant.renderer.handle,
        10000
      );
      if (result !== 0) {
        throw new Error(`Kernel step failed: ${result}`);
      }
      if (round >= 10) {
        variant.times.push(performance.now() - start);
      }
    }
  }
  const fields = variants.map(({ renderer }) => renderer.field().pressure);
  if (
    fields[0].length === 0 ||
    !fields[0].some((value) => value !== 0) ||
    fields[0].length !== fields[1].length ||
    !fields[0].every(
      (value, i) => Number.isFinite(value) && Object.is(value, fields[1][i])
    )
  ) {
    throw new Error('Pressure fields differ');
  }
  console.log(
    JSON.stringify({
      cells: fields[0].length,
      steps: 10000,
      builds: variants.map(({ file, times }) => ({
        file,
        milliseconds: times,
      })),
      identical: true,
    })
  );
} finally {
  for (const { renderer } of variants) {
    renderer.free();
  }
}
