/**
 * 3D FDTD solver on the sparse voxel model: geometry, resonances, levels
 * and determinism. Uses coarse 1 cm cells so every runtime stays fast.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  CELL_AIR,
  CELL_NOSE,
  CELL_SINUS,
  CELL_TRACT,
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_SINUS,
  LINK_VELUM,
  buildVoxelModel,
} from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms, spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const DX = 1;
const RATE = 16000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx: DX });
/** The same grid without the piriform fossae and the vallecula. */
const bare = buildVoxelModel(DEFAULT_HEAD, {
  dx: DX,
  piriform: false,
  vallecula: false,
});

function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

/** Spectral peaks (Hz) of a solver's impulse response. */
function responsePeaks(solver, rate, seconds = 0.06) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate);
}

/** Spectral peaks (Hz) of the 3D impulse response for a static vowel. */
function impulsePeaks(shape, voxels = bare) {
  const solver = new Fdtd3d({ model: voxels });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, 0);
  return responsePeaks(solver, 1 / solver.stepDuration(shape));
}

/** Spectral peaks (Hz) of the waveguide impulse response. */
function waveguidePeaks(areas, length, options = {}) {
  const solver = new Waveguide({ sections: areas.length, ...options });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(areas, 0);
  return responsePeaks(solver, (areas.length * SPEED_OF_SOUND) / length);
}

/** Air volume (cm³) and open area into the tract (cm²) of each pouch. */
function pouchAir(solver) {
  const { cells, links, sinuses } = solver.model;
  const air = new Map(
    sinuses.map((sinus) => [sinus.tube, { volume: 0, opening: 0 }])
  );
  cells.forEach((cell, index) => {
    if (cell.kind === CELL_SINUS) {
      air.get(cell.tube).volume += solver.fill[index] * DX ** 3;
    }
  });
  links.kind.forEach((kind, link) => {
    if (kind === LINK_SINUS) {
      const [a, b] = [links.a[link], links.b[link]];
      const pouch = cells[a].kind === CELL_SINUS ? cells[a] : cells[b];
      air.get(pouch.tube).opening +=
        Math.min(solver.fill[a], solver.fill[b]) * DX * DX;
    }
  });
  return air;
}

function relativeError(value, target) {
  return Math.abs(value - target) / target;
}

describe('voxel model', () => {
  it('holds tract, nose and free air connected at lips, nostrils and velum', () => {
    const counts = [0, 0, 0, 0];
    for (const cell of model.cells) {
      counts[cell.kind]++;
    }
    expect(counts[CELL_TRACT]).toBeGreaterThan(100);
    expect(counts[CELL_NOSE]).toBeGreaterThan(20);
    expect(counts[CELL_AIR]).toBeGreaterThan(50);
    expect(counts[CELL_SINUS]).toBeGreaterThan(10);
    for (const kind of [LINK_LIPS, LINK_NOSTRILS, LINK_VELUM, LINK_SINUS]) {
      expect(
        model.links.kind.filter((value) => value === kind).length
      ).toBeGreaterThan(0);
    }
    const open = Array.from(model.openFaces).reduce((a, b) => a + b, 0);
    expect(open).toBeGreaterThan(0);
  });

  it('opens the pouches into the tract only at their upper end', () => {
    const names = model.sinuses.map((sinus) => sinus.name);
    expect(names.join()).toBe('piriform-left,piriform-right,vallecula');
    const opened = new Set();
    model.links.kind.forEach((kind, link) => {
      const a = model.cells[model.links.a[link]];
      const b = model.cells[model.links.b[link]];
      if (a.kind !== CELL_SINUS && b.kind !== CELL_SINUS) {
        return;
      }
      if (kind === LINK_SINUS) {
        const [pouch, tract] = a.kind === CELL_SINUS ? [a, b] : [b, a];
        expect(tract.kind).toBe(CELL_TRACT);
        expect(pouch.arc).toBeLessThan(1.5 * DX + 1e-9);
        opened.add(pouch.tube);
      } else {
        expect(a.tube).toBe(b.tube);
      }
    });
    expect(opened.size).toBe(3);
    expect(bare.cells.some((cell) => cell.kind === CELL_SINUS)).toBe(false);
    expect(bare.sinuses.length).toBe(0);
  });

  it('gives each pouch its anatomical volume and an open neck', () => {
    const solver = new Fdtd3d({ model });
    const shape = vowelShape('ə');
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    const air = pouchAir(solver);
    for (const sinus of model.sinuses) {
      const { volume, opening } = air.get(sinus.tube);
      expect(relativeError(volume, sinus.area * sinus.length)).toBeLessThan(
        0.05
      );
      // A narrow neck would turn the pouch into a Helmholtz resonator.
      expect(opening).toBeGreaterThan(0.4 * sinus.area);
    }
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

describe('3D FDTD geometry against the waveguide', () => {
  it('resonates like the waveguide in a uniform tube', () => {
    const areas = new Array(44).fill(3);
    const solver = new Fdtd3d({ model: bare });
    solver.setShape(areas, 0, undefined, null);
    const peaks = responsePeaks(solver, 1 / solver.stepDuration(), 0.08);
    const length = bare.lengths[CELL_TRACT];
    const reference = waveguidePeaks(areas, length, { piriform: false });
    for (const target of reference.slice(0, 3)) {
      const nearest = peaks.reduce((best, peak) =>
        Math.abs(peak - target) < Math.abs(best - target) ? peak : best
      );
      expect(relativeError(nearest, target)).toBeLessThan(0.12);
    }
  });

  it('lowers /ɑ/ F1 with the piriform fossae as much as the waveguide', () => {
    const shape = vowelShape('ɑ');
    const piriform = buildVoxelModel(DEFAULT_HEAD, {
      dx: DX,
      vallecula: false,
    });
    const shift3d = impulsePeaks(shape, piriform)[0] / impulsePeaks(shape)[0];
    const [withFossae, without] = [true, false].map(
      (enabled) =>
        waveguidePeaks(shape.areas, shape.length, { piriform: enabled })[0]
    );
    const shift1d = withFossae / without;
    expect(shift1d).toBeLessThan(0.93);
    expect(shift3d).toBeLessThan(0.93);
    expect(Math.abs(shift3d - shift1d)).toBeLessThan(0.05);
  });

  it('runs slower for a longer tract so the formants follow its length', () => {
    const solver = new Fdtd3d({ model: bare });
    const rest = bare.lengths[CELL_TRACT];
    expect(solver.stepDuration({})).toBe(solver.stepDuration());
    expect(
      relativeError(
        solver.stepDuration({ length: rest * 1.1 }),
        solver.stepDuration() * 1.1
      )
    ).toBeLessThan(1e-12);
  });
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

  it('renders bit-identically with the wasm and JavaScript kernels', () => {
    const solver = new Fdtd3d({ model });
    const reference = new Fdtd3d({ model, kernel: 'js' });
    expect(reference.kernel).toBe(null);
    if (solver.kernel) {
      const js = renderPlan(plan, { ...options, kernel: 'js' });
      expect(js.every((value, index) => value === samples[index])).toBe(true);
    }
  });

  it('skips coefficient updates when the shape does not change', () => {
    const solver = new Fdtd3d({ model });
    const shape = vowelShape('a');
    solver.setShape(shape.areas, 0.2);
    const damping = Float64Array.from(solver.damping);
    solver.damping.fill(0);
    solver.setShape(Float64Array.from(shape.areas), 0.2);
    expect(solver.damping.every((value) => value === 0)).toBe(true);
    solver.setShape(shape.areas, 0.3);
    expect(solver.damping.some((value) => value !== 0)).toBe(true);
    solver.damping.set(damping);
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
