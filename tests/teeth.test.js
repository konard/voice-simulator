/**
 * Teeth in the acoustics: the incisor constriction of the area function,
 * the obstacle noise source of sibilants and the solid teeth voxels of the
 * 3D model.
 */

import { describe, it, expect } from 'test-anywhere';
import { rms } from '../src/acoustics/analysis.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Biquad } from '../src/acoustics/filters.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { teethGap } from '../src/articulation/teeth.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const RATE = 16000;
/** Sibilant energy reaches 10 kHz, so the level test needs a wide band. */
const WIDE_RATE = 32000;

function vowelState(symbol) {
  return { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 };
}

/** Articulator state in the middle of the first consonant of `text`. */
function consonantState(text) {
  const plan = planUtterance(text);
  const segment = plan.segments.find((entry) => entry.kind === 'consonant');
  return sampleState(plan, (segment.start + segment.end) / 2);
}

function highFrequencyLevel(text, options) {
  const plan = planUtterance(text);
  const samples = renderPlan(plan, { sampleRate: WIDE_RATE, ...options });
  const filters = [new Biquad(), new Biquad()];
  filters[0].highpass(4000, 0.54, WIDE_RATE);
  filters[1].highpass(4000, 1.31, WIDE_RATE);
  const high = samples.map((value) =>
    filters[1].process(filters[0].process(value))
  );
  const segment = plan.segments.find((entry) => entry.kind === 'consonant');
  return rms(
    high,
    Math.round(segment.start * WIDE_RATE),
    Math.round(segment.end * WIDE_RATE)
  );
}

describe('incisor constriction', () => {
  it('opens the teeth with the jaw and closes them for sibilants', () => {
    const close = teethGap(vowelState('i'), DEFAULT_HEAD);
    const open = teethGap(vowelState('ɑ'), DEFAULT_HEAD);
    const sibilant = teethGap(consonantState('ˈasa'), DEFAULT_HEAD);
    expect(open).toBeGreaterThan(close + 0.8);
    expect(sibilant).toBeLessThan(close);
    expect(sibilant).toBeGreaterThan(0.1);
    const wide = normalizeHeadConfig({ jawRange: 1.3 });
    expect(teethGap(vowelState('ɑ'), wide)).toBeGreaterThan(open);
  });

  it('narrows the area function just behind the lips', () => {
    const state = consonantState('ˈasa');
    const shape = tractShape(state, DEFAULT_HEAD);
    const plain = tractShape(state, DEFAULT_HEAD, { teeth: false });
    expect(plain.teeth).toBe(null);
    expect(shape.teeth.index).toBeGreaterThan(shape.areas.length * 0.85);
    expect(shape.areas[shape.teeth.index]).toBeLessThan(
      shape.teeth.area + 1e-9
    );
    shape.areas.forEach((area, index) => {
      expect(area).toBeLessThan(plain.areas[index] + 1e-9);
    });
    expect(shape.areas[shape.teeth.index + 1]).toBeLessThan(
      plain.areas[shape.teeth.index + 1]
    );
  });

  it('puts the sibilant source past the teeth as an obstacle source', () => {
    const shape = tractShape(consonantState('ˈasa'), DEFAULT_HEAD);
    expect(shape.frication.obstacle).toBeGreaterThan(0.9);
    expect(shape.frication.position).toBe(shape.teeth.outlet);
    const plain = tractShape(consonantState('ˈasa'), DEFAULT_HEAD, {
      teeth: false,
    });
    expect(plain.frication.obstacle).toBe(0);
    const fricative = tractShape(consonantState('ˈafa'), DEFAULT_HEAD);
    expect(fricative.frication.obstacle).toBe(0);
  });

  it('leaves vowel formant regions almost unchanged', () => {
    for (const symbol of ['i', 'u', 'ə']) {
      const shape = tractShape(vowelState(symbol), DEFAULT_HEAD);
      const plain = tractShape(vowelState(symbol), DEFAULT_HEAD, {
        teeth: false,
      });
      const formants = tubeFormants(shape.areas, shape.length, { count: 3 });
      const reference = tubeFormants(plain.areas, plain.length, { count: 3 });
      formants.forEach((value, index) => {
        const change = Math.abs(value - reference[index]) / reference[index];
        expect(change).toBeLessThan(0.05);
      });
    }
  });
});

describe('teeth obstacle noise', () => {
  for (const text of ['ˈasa', 'ˈaʃa']) {
    it(`gives ${text} more high-frequency energy than a tract without teeth`, () => {
      const teeth = highFrequencyLevel(text, {});
      const none = highFrequencyLevel(text, { teeth: false });
      expect(teeth).toBeGreaterThan(1.5 * none);
    });
  }

  it('does not change non-sibilant fricatives much', () => {
    const teeth = highFrequencyLevel('ˈafa', {});
    const none = highFrequencyLevel('ˈafa', { teeth: false });
    expect(teeth / none).toBeGreaterThan(0.7);
    expect(teeth / none).toBeLessThan(1.4);
  });
});

describe('teeth voxels', () => {
  const model = buildVoxelModel(DEFAULT_HEAD, { dx: 1 });

  function solidCells(solver, state) {
    const shape = tractShape(state, DEFAULT_HEAD);
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    return Array.from(model.teeth.cells).filter((cell) => solver.solid[cell]);
  }

  it('marks tract cells behind the lips as teeth', () => {
    expect(model.teeth.cells.length).toBeGreaterThan(4);
    const length = model.lengths[0];
    for (const cell of model.teeth.cells) {
      expect(model.cells[cell].kind).toBe(0);
      expect(model.cells[cell].arc).toBeGreaterThan(length - 2.5);
      expect(model.cells[cell].arc).toBeLessThan(length);
    }
  });

  it('makes teeth cells solid walls with a slot that follows the jaw', () => {
    const solver = new Fdtd3d({ model, kernel: 'js' });
    const sibilant = solidCells(solver, consonantState('ˈasa'));
    expect(sibilant.length).toBeGreaterThan(0);
    for (let link = 0; link < solver.linkCount; link++) {
      if (
        solver.solid[solver.linkA[link]] ||
        solver.solid[solver.linkB[link]]
      ) {
        expect(solver.conductance[link]).toBe(0);
      }
    }
    const open = solidCells(solver, vowelState('ɑ'));
    expect(open.length).toBeLessThan(sibilant.length);
    expect(open.length).toBeGreaterThan(0);
    // Without teeth the slices are ordinary tube again.
    solver.setShape(tractShape(vowelState('ɑ'), DEFAULT_HEAD).areas, 0);
    expect(solver.solid.every((value) => value === 0)).toBe(true);
  });

  it('opens each incisor slice by the slot area at any grid size', () => {
    for (const dx of [1, 0.5]) {
      const grid = dx === 1 ? model : buildVoxelModel(DEFAULT_HEAD, { dx });
      const solver = new Fdtd3d({ model: grid, kernel: 'js' });
      for (const symbol of ['i', 'ə', 'ɑ']) {
        const shape = tractShape(vowelState(symbol), DEFAULT_HEAD);
        solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
        const slot = shape.teeth.gap * grid.teeth.width;
        const open = new Map();
        grid.teeth.cells.forEach((cell, position) => {
          const group = grid.teeth.groups[position];
          open.set(
            group,
            (open.get(group) ?? 0) + solver.openness[cell] * dx * dx
          );
        });
        for (const area of open.values()) {
          expect(Math.abs(area - slot) / slot).toBeLessThan(0.02);
        }
      }
    }
  });

  it('stays stable and deterministic with moving teeth', () => {
    const plan = planUtterance('ˈasi');
    const options = { sampleRate: RATE, solver: 'fdtd3d', model };
    const samples = renderPlan(plan, options);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(rms(samples)).toBeGreaterThan(0.01);
    const js = renderPlan(plan, { ...options, kernel: 'js' });
    expect(js.every((value, index) => value === samples[index])).toBe(true);
  });
});
