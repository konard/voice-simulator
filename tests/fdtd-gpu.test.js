/**
 * Queued steps and asynchronous rendering of the 3D solver, and its
 * WebGPU step loop (src/acoustics/fdtd-gpu.js) against the CPU kernel.
 * The GPU tests run where the runtime has a WebGPU adapter (Deno, which
 * falls back to a software adapter on machines without a GPU).
 */

import { describe, it, expect } from 'test-anywhere';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { requestGpuDevice } from '../src/acoustics/fdtd-gpu.js';
import {
  VoiceRenderer,
  renderPlan,
  renderPlanAsync,
} from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';
import { measureAudioTierAsync } from '../src/perf/benchmark.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { synthesize, synthesizeAsync } from '../src/synthesize.js';
import { itUnless } from './helpers/skip.js';

const RATE = 16000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx: 1 });
const shapes = ['a', 'i'].map((symbol) =>
  tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  )
);

// Before any test is registered, like the network probes.
const device = await requestGpuDevice().catch(() => null);
const noGpu = device ? null : 'no WebGPU adapter in this runtime';

/**
 * Drive a solver with alternating vowels, a pulsed source and frication
 * noise in the second half, through queueStep and flushSteps.
 */
async function drive(solver, steps = 1200, flushEvery = 500) {
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

function relativeError(actual, expected) {
  let error = 0;
  let energy = 0;
  for (let index = 0; index < expected.length; index++) {
    error += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(error / energy);
}

describe('queued 3D FDTD steps on the CPU', () => {
  it('give the outputs of step()', async () => {
    const queued = await drive(new Fdtd3d({ model }));
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(DEFAULT_HEAD).areas);
    const direct = new Float64Array(queued.length);
    for (let step = 0; step < direct.length; step++) {
      if (step % 100 === 0) {
        const shape = shapes[(step / 100) % 2];
        solver.setShape(shape.areas, shape.velumArea, shape.velumIndex);
      }
      const flow = Math.sin(step * 0.05) * (step % 80 < 40 ? 1 : 0);
      const noise = step > direct.length / 2 ? Math.sin(step * 1.7) * 0.3 : 0;
      direct[step] = solver.step(flow, 30, noise);
    }
    expect(queued.every((value, index) => value === direct[index])).toBe(true);
  });

  it('render a plan bit-identically through renderPlanAsync', async () => {
    const plan = planUtterance('ˈasi');
    const options = { sampleRate: RATE, solver: 'fdtd3d', model };
    const reference = renderPlan(plan, options);
    const samples = await renderPlanAsync(plan, { ...options, chunkSize: 777 });
    expect(samples.length).toBe(reference.length);
    expect(samples.every((value, index) => value === reference[index])).toBe(
      true
    );
  });

  it('render the waveguide through renderAsync as through render', async () => {
    const plan = planUtterance('ˈma');
    const renderer = new VoiceRenderer(plan, { sampleRate: RATE });
    const samples = new Float32Array(renderer.totalSamples);
    await renderer.renderAsync(samples);
    const reference = renderPlan(plan, { sampleRate: RATE });
    expect(samples.every((value, index) => value === reference[index])).toBe(
      true
    );
  });

  it('synthesize the same speech with synthesizeAsync', async () => {
    const options = { tier: 'high', dx: 1, sampleRate: RATE };
    const reference = synthesize('papa', options);
    const result = await synthesizeAsync('papa', options);
    expect(result.ipa).toBe(reference.ipa);
    expect(
      result.samples.every((value, index) => value === reference.samples[index])
    ).toBe(true);
  });
});

describe('WebGPU 3D FDTD step loop', () => {
  itUnless(noGpu)(
    'refuses step() and follows the CPU kernel at the lips',
    async () => {
      const cpu = await drive(new Fdtd3d({ model }));
      const solver = new Fdtd3d({ model, device });
      try {
        expect(() => solver.step(0, 0, 0)).toThrow();
        const gpu = await drive(solver);
        expect(gpu.length).toBe(cpu.length);
        expect(relativeError(gpu, cpu)).toBeLessThan(1e-3);
      } finally {
        solver.gpu.destroy();
      }
    }
  );

  itUnless(noGpu)('follows the CPU kernel at a microphone', async () => {
    const microphone = { distance: 10 };
    const head = DEFAULT_HEAD;
    const cpu = await drive(new Fdtd3d({ head, dx: 1, microphone }), 800);
    const solver = new Fdtd3d({ head, dx: 1, microphone, device });
    try {
      const gpu = await drive(solver, 800);
      expect(relativeError(gpu, cpu)).toBeLessThan(1e-3);
    } finally {
      solver.gpu.destroy();
    }
  });

  itUnless(noGpu)('renders speech and the RMS pressure field', async () => {
    const plan = planUtterance('ˈasa');
    const options = { sampleRate: RATE, solver: 'fdtd3d', model };
    const reference = renderPlan(plan, options);
    const renderer = new VoiceRenderer(plan, { ...options, device });
    try {
      const samples = new Float32Array(renderer.totalSamples);
      const half = Math.floor(samples.length / 2);
      await renderer.renderAsync(samples.subarray(0, half), { field: true });
      const { pressure } = renderer.solver.field();
      expect(pressure.some((value) => value > 0)).toBe(true);
      await renderer.renderAsync(samples.subarray(half));
      expect(relativeError(samples, reference)).toBeLessThan(1e-3);
    } finally {
      renderer.solver.gpu.destroy();
    }
  });

  itUnless(noGpu)('measures the load of a 3D tier on the GPU', async () => {
    const high = AUDIO_TIERS.find((tier) => tier.name === 'high');
    const load = await measureAudioTierAsync(high, {
      device,
      seconds: 0.05,
      chunk: 256,
    });
    expect(load > 0).toBe(true);
    expect(Number.isFinite(load)).toBe(true);
  });
});
