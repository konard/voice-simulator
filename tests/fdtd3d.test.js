/**
 * 3D FDTD solver on the sparse voxel model: geometry, resonances, levels
 * and determinism. Uses coarse 1 cm cells so every runtime stays fast.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  CELL_AIR,
  CELL_NOSE,
  CELL_TRACT,
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_VELUM,
  buildVoxelModel,
} from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const DX = 1;
const RATE = 16000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx: DX });

function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

/** Spectral peaks (Hz) of the impulse response for a static vowel. */
function impulsePeaks(shape) {
  const solver = new Fdtd3d({ model });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, 0);
  const rate = 1 / solver.stepDuration();
  const response = new Float64Array(Math.round(rate * 0.06));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  const spectrum = [];
  for (let frequency = 100; frequency <= 4000; frequency += 10) {
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * frequency) / rate;
    for (let n = 0; n < response.length; n++) {
      re += response[n] * Math.cos(omega * n);
      im -= response[n] * Math.sin(omega * n);
    }
    spectrum.push([frequency, Math.hypot(re, im)]);
  }
  return spectrum
    .filter(
      ([, magnitude], index) =>
        index > 0 &&
        index < spectrum.length - 1 &&
        magnitude > spectrum[index - 1][1] &&
        magnitude > spectrum[index + 1][1]
    )
    .map(([frequency]) => frequency);
}

function relativeError(value, target) {
  return Math.abs(value - target) / target;
}

describe('voxel model', () => {
  it('holds tract, nose and free air connected at lips, nostrils and velum', () => {
    const counts = [0, 0, 0];
    for (const cell of model.cells) {
      counts[cell.kind]++;
    }
    expect(counts[CELL_TRACT]).toBeGreaterThan(100);
    expect(counts[CELL_NOSE]).toBeGreaterThan(20);
    expect(counts[CELL_AIR]).toBeGreaterThan(50);
    for (const kind of [LINK_LIPS, LINK_NOSTRILS, LINK_VELUM]) {
      expect(
        model.links.kind.filter((value) => value === kind).length
      ).toBeGreaterThan(0);
    }
    const open = Array.from(model.openFaces).reduce((a, b) => a + b, 0);
    expect(open).toBeGreaterThan(0);
  });

  it('gets finer with smaller cells', () => {
    const fine = buildVoxelModel(DEFAULT_HEAD, { dx: 0.8 });
    expect(fine.cells.length).toBeGreaterThan(model.cells.length);
  });
});

describe('3D FDTD resonances', () => {
  for (const symbol of ['ə', 'i', 'ɑ']) {
    it(`/${symbol}/ formants are within 20% of the tube model`, () => {
      const shape = vowelShape(symbol);
      const peaks = impulsePeaks(shape);
      const [f1, f2] = tubeFormants(shape.areas, shape.length, { count: 2 });
      expect(relativeError(peaks[0], f1)).toBeLessThan(0.2);
      const nearest = peaks.reduce((best, peak) =>
        Math.abs(peak - f2) < Math.abs(best - f2) ? peak : best
      );
      expect(relativeError(nearest, f2)).toBeLessThan(0.2);
    });
  }
});

describe('3D FDTD rendering', () => {
  const plan = planUtterance('ˈmasa');
  const options = { sampleRate: RATE, solver: 'fdtd3d', model };
  const samples = renderPlan(plan, options);

  it('is stable and about as loud as the waveguide', () => {
    expect(samples.every(Number.isFinite)).toBe(true);
    const wave = renderPlan(plan, { sampleRate: RATE });
    const ratio = rms(samples) / rms(wave);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  it('is deterministic', () => {
    const again = renderPlan(plan, options);
    expect(again.length).toBe(samples.length);
    expect(again.every((value, index) => value === samples[index])).toBe(true);
  });

  it('works with a microphone in front of the lips', () => {
    const heard = renderPlan(planUtterance('ˈa'), {
      ...options,
      output: 'microphone',
    });
    expect(heard.every(Number.isFinite)).toBe(true);
    expect(rms(heard)).toBeGreaterThan(0.01);
  });

  it('exposes the pressure field and resets it', () => {
    const solver = new Fdtd3d({ model });
    solver.setShape(vowelShape('a').areas, 0);
    for (let n = 0; n < 200; n++) {
      solver.step(n < 20 ? 1 : 0, 0, 0);
    }
    const field = solver.field();
    expect(field.positions.length).toBe(model.cells.length * 3);
    expect(field.pressure.length).toBe(model.cells.length);
    expect(field.kinds.length).toBe(model.cells.length);
    expect(field.pressure.some((value) => value !== 0)).toBe(true);
    solver.reset();
    expect(solver.field().pressure.every((value) => value === 0)).toBe(true);
  });
});
