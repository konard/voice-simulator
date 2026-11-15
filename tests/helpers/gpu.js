/**
 * The WebGPU device of a test file and the helpers that compare the GPU
 * step loop of the 3D solver with the CPU kernel (tests/fdtd-gpu.test.js,
 * tests/heavy/gpu-solver.test.js).
 *
 * Without an adapter the GPU tests are skipped with `noGpu` as the reason
 * (see itUnless in skip.js). Where CI is meant to have an adapter it sets
 * REQUIRE_GPU=1, and there a missing adapter fails the file: a skip would
 * hide it.
 */

import process from 'node:process';
import {
  describeGpuDevice,
  requestGpuDevice,
} from '../../src/acoustics/fdtd-gpu.js';
import { noseShape } from '../../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';

export const NO_GPU = 'no WebGPU adapter in this runtime';

/**
 * @param {{gpu?: object, env?: Record<string, string|undefined>}} [options]
 *   `gpu` replaces `navigator.gpu`; `env` replaces `process.env`.
 * @returns {Promise<{device: object|null, noGpu: string|null, info: ReturnType<typeof describeGpuDevice>}>}
 */
export async function gpuForTests({ gpu, env = process.env } = {}) {
  const device = await requestGpuDevice(gpu ? { gpu } : {}).catch(() => null);
  if (!device && env.REQUIRE_GPU === '1') {
    throw new Error('REQUIRE_GPU=1 but this runtime has no WebGPU adapter');
  }
  return {
    device,
    noGpu: device ? null : NO_GPU,
    info: describeGpuDevice(device),
  };
}

/**
 * Drive a solver with alternating vowels, a pulsed source and frication
 * noise in the second half, through queueStep and flushSteps.
 * @param {object} solver an Fdtd3d
 * @param {number} [steps]
 * @param {number} [flushEvery] steps between two flushSteps
 * @param {{areas: number[], velumArea: number, velumIndex: number}[]} shapes
 *   the two vowel shapes to alternate every 100 steps
 * @returns {Promise<Float64Array>} the output of every step
 */
export async function drive(solver, steps = 1200, flushEvery = 500, shapes) {
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  const outputs = [];
  for (let step = 0; step < steps; step++) {
    if (step % 100 === 0) {
      const shape = shapes[(step / 100) % 2];
      solver.setShape(shape.areas, shape.velumArea, shape.velumIndex);
    }
    const flow = Math.sin(step * 0.05) * (step % 80 < 40 ? 1 : 0);
    const noise = step > steps / 2 ? Math.sin(step * 1.7) * 0.3 : 0;
    solver.queueStep(flow, 30, noise);
    if (step % flushEvery === flushEvery - 1) {
      outputs.push(...(await solver.flushSteps()));
    }
  }
  outputs.push(...(await solver.flushSteps()));
  return Float64Array.from(outputs);
}

/**
 * Root of the error energy over the energy of `expected`.
 * @param {ArrayLike<number>} actual
 * @param {ArrayLike<number>} expected
 * @param {number} [start] first index compared
 * @param {number} [end] index after the last one compared
 */
export function relativeError(
  actual,
  expected,
  start = 0,
  end = expected.length
) {
  let error = 0;
  let energy = 0;
  for (let index = start; index < end; index++) {
    error += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(error / energy);
}

/**
 * Index of the first block of `size` samples whose own relative error is
 * above `limit`, or -1: where a GPU run starts to drift from the CPU.
 * @param {ArrayLike<number>} actual
 * @param {ArrayLike<number>} expected
 * @param {{size?: number, limit?: number}} [options]
 */
export function firstDivergentBlock(
  actual,
  expected,
  { size = 500, limit = 1e-4 } = {}
) {
  for (let block = 0; block * size < expected.length; block++) {
    const start = block * size;
    const end = Math.min(expected.length, start + size);
    if (relativeError(actual, expected, start, end) > limit) {
      return block;
    }
  }
  return -1;
}
