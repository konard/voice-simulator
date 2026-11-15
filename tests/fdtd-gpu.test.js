/**
 * Queued steps and asynchronous rendering of the 3D solver, and its
 * WebGPU step loop (src/acoustics/fdtd-gpu.js) against the CPU kernel.
 * The GPU tests run where the runtime has a WebGPU adapter (Deno, which
 * falls back to a software adapter on machines without a GPU); with
 * REQUIRE_GPU=1 a missing adapter is a failure (tests/helpers/gpu.js).
 */

import { describe, it, expect } from 'test-anywhere';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import {
  VoiceRenderer,
  renderPlan,
  renderPlanAsync,
} from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';
import { measureAudioTierAsync } from '../src/perf/benchmark.js';
import { synthesize, synthesizeAsync } from '../src/synthesize.js';
import {
  drive as driveSolver,
  gpuForTests,
  relativeError,
  vowelShapes,
} from './helpers/gpu.js';
import { itUnless } from './helpers/skip.js';

const RATE = 16000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx: 1 });
const shapes = vowelShapes();

// Before any test is registered, like the network probes. With
// REQUIRE_GPU=1 a runtime without an adapter fails here: no silent skip.
const { device, noGpu, info } = await gpuForTests();
const drive = (solver, steps, flushEvery) =>
  driveSolver(solver, steps, flushEvery, shapes);

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
      console.log('WebGPU adapter:', JSON.stringify(info));
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

  itUnless(noGpu)('renderPlanAsync frees the GPU buffers it made', async () => {
    const buffers = [];
    let destroyed = 0;
    // The real device, except that the buffers it makes count destroy().
    const counting = new Proxy(device, {
      get(target, key) {
        if (key === 'createBuffer') {
          return (descriptor) => {
            const buffer = target.createBuffer(descriptor);
            const destroy = buffer.destroy.bind(buffer);
            buffer.destroy = () => {
              destroyed++;
              destroy();
            };
            buffers.push(buffer);
            return buffer;
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const plan = planUtterance('ˈa');
    const options = { sampleRate: RATE, solver: 'fdtd3d', model };
    await renderPlanAsync(plan, { ...options, device: counting });
    expect(buffers.length > 0).toBe(true);
    expect(destroyed >= buffers.length).toBe(true);
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
