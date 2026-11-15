/**
 * Heavy check (issue 30): the WebGPU step loop of the 3D solver against the
 * CPU kernel over a long run and over whole words at the 3D tiers, written
 * as reports/heavy/gpu-solver.md and .json with the adapter it ran on.
 * Run with `npm run test:heavy -- --suite gpu`, which runs this file in
 * Deno (Node.js and Bun have no WebGPU). HEAVY_LIMIT scales the long run
 * (4000 steps per unit, default 5) and limits the tiers (default 2).
 *
 * With REQUIRE_GPU=1, as in the `Heavy checks` workflow, a runtime without
 * an adapter fails here: no test is silently skipped. The GPU solvers of
 * synthesizeAsync are destroyed by renderPlanAsync when it is done.
 */

import { describe, expect } from 'test-anywhere';
import { performance } from 'node:perf_hooks';
import { buildVoxelModel } from '../../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../../src/acoustics/fdtd3d.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';
import { synthesize, synthesizeAsync } from '../../src/synthesize.js';
import {
  drive,
  firstDivergentBlock,
  gpuForTests,
  relativeError,
  vowelShapes,
} from '../helpers/gpu.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const TOLERANCE = 1e-3;
const WORD = 'həˈloʊ';
const TIERS = Object.freeze(['high', 'ultra', 'studio']);

const { device, noGpu, info } = await gpuForTests();
const model = buildVoxelModel(DEFAULT_HEAD, { dx: 1 });
const shapes = vowelShapes();
const rows = [];

async function timed(callback) {
  const start = performance.now();
  const value = await callback();
  return { value, seconds: (performance.now() - start) / 1000 };
}

/**
 * Record a comparison, and where it fails, the first block of 500 samples
 * whose own relative error is above 1e-4 and the adapter it ran on.
 */
function compare(name, cpu, gpu) {
  const error = relativeError(gpu.value, cpu.value);
  rows.push({
    name,
    steps: cpu.value.length,
    cpuSeconds: cpu.seconds,
    gpuSeconds: gpu.seconds,
    error,
  });
  if (!(error < TOLERANCE)) {
    console.error(
      `${name}: relative error ${error}; first block of 500 above 1e-4: ${firstDivergentBlock(
        gpu.value,
        cpu.value
      )}; adapter ${JSON.stringify(info)}`
    );
  }
  expect(gpu.value.length).toBe(cpu.value.length);
  expect(gpu.value.every(Number.isFinite)).toBe(true);
  expect(error).toBeLessThan(TOLERANCE);
}

function formatRow(row) {
  return `| ${row.name} | ${row.steps} | ${row.cpuSeconds.toFixed(2)} | ${row.gpuSeconds.toFixed(2)} | ${row.error.toPrecision(3)} |`;
}

describe('WebGPU 3D solver against the CPU kernel', () => {
  itUnless(noGpu)('long run follows the CPU kernel', async () => {
    console.log('WebGPU adapter:', JSON.stringify(info));
    const steps = 4000 * heavyLimit(5);
    const cpu = await timed(() =>
      drive(new Fdtd3d({ model }), steps, 500, shapes)
    );
    const solver = new Fdtd3d({ model, device });
    try {
      const gpu = await timed(() => drive(solver, steps, 500, shapes));
      expect(cpu.value.length).toBe(steps);
      expect(cpu.value.every(Number.isFinite)).toBe(true);
      compare(`long run, ${steps} steps`, cpu, gpu);
    } finally {
      solver.gpu.destroy();
    }
  });

  for (const tier of TIERS.slice(0, heavyLimit(2))) {
    itUnless(noGpu)(`speaks the same at tier ${tier}`, async () => {
      const options = { ipa: true, seed: 1, tier, engine: 'js' };
      const cpu = await timed(() => synthesize(WORD, options).samples);
      const gpu = await timed(async () => {
        const result = await synthesizeAsync(WORD, { ...options, device });
        return result.samples;
      });
      compare(`${WORD} at tier ${tier}`, cpu, gpu);
    });
  }

  itUnless(noGpu)('writes the report', () => {
    const markdown = [
      '## WebGPU 3D solver against the CPU kernel',
      '',
      `Adapter: ${JSON.stringify(info)}. Deno ${globalThis.Deno?.version.deno ?? '-'}. Relative error = root of the error energy over the energy of the CPU output; the tolerance is ${TOLERANCE}. A software adapter says nothing about GPU speed.`,
      '',
      '| Comparison | Steps or samples | CPU seconds | GPU seconds | Relative error |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map(formatRow),
      '',
    ].join('\n');
    writeReport('gpu-solver', markdown, {
      adapter: info,
      deno: globalThis.Deno?.version.deno,
      rows,
    });
    expect(rows.length).toBe(1 + Math.min(TIERS.length, heavyLimit(2)));
  });
});
