/**
 * 2D FDTD sheet (issue 37): geometry of the sheet, resonances against the
 * tube model and the waveguide, a transverse mode the waveguide cannot
 * have, laterals, levels and the time step.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  SHEET_DX,
  buildSheet,
  updateSheet,
} from '../src/acoustics/sheet-model.js';
import { COURANT_2D, Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { rms, spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { consonantTarget, vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { synthesize } from '../src/index.js';
import { itUnless } from './helpers/skip.js';

/** Why the murmur stays above half the level of the vowel. */
const NASAL_TARGET_BLOCKED =
  'blocked: the first harmonic of the vowel puts a floor near 0.71 (experiments/issue-84-first-harmonic.mjs)';

function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

function relativeError(value, target) {
  return Math.abs(value - target) / target;
}

function nearest(peaks, target) {
  return peaks.reduce((best, peak) =>
    Math.abs(peak - target) < Math.abs(best - target) ? peak : best
  );
}

/** Spectral peaks (Hz) of a solver's impulse response. */
function responsePeaks(solver, rate, seconds = 0.08) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 });
}

/** Spectral peaks (Hz) of the 2D impulse response for a static shape. */
function sheetPeaks(shape, options = {}) {
  const solver = new Fdtd2d({ head: DEFAULT_HEAD, ...options });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth, shape);
  solver.setLength(shape.length);
  return responsePeaks(solver, 1 / solver.stepDuration(shape));
}

/** Spectral peaks (Hz) of the waveguide impulse response. */
function waveguidePeaks(areas, length, options = {}) {
  const solver = new Waveguide({ sections: areas.length, ...options });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(areas, 0);
  solver.setLength(length);
  return responsePeaks(solver, (areas.length * SPEED_OF_SOUND) / length);
}

/** Depths of one column of the sheet. */
function columnDepths(sheet, column) {
  return Array.from(
    sheet.h.subarray(column * sheet.rows, (column + 1) * sheet.rows)
  );
}

describe('2D sheet geometry', () => {
  it('uses 0.6 cm cells and a fixed number of rows', () => {
    const sheet = buildSheet(DEFAULT_HEAD);
    expect(sheet.dx).toBe(SHEET_DX);
    const widest = Math.max(...sheet.widths);
    expect(sheet.rows).toBe(Math.ceil(widest / sheet.dx) + 2);
    expect(COURANT_2D).toBe(0.68);
  });

  for (const symbol of ['ɑ', 'i', 'u']) {
    it(`/${symbol}/ keeps the area of every column`, () => {
      const shape = vowelShape(symbol);
      const sheet = updateSheet(buildSheet(DEFAULT_HEAD), shape);
      for (let column = 0; column < sheet.columns; column++) {
        const depths = columnDepths(sheet, column);
        const area = depths.reduce((sum, h) => sum + h, 0) * sheet.dx;
        expect(Math.abs(area - sheet.areas[column])).toBeLessThan(1e-9);
        // Cells are open (at least the wall depth) or walls.
        expect(depths.every((h) => h === 0 || h >= 0.02 - 1e-12)).toBe(true);
      }
      // The columns keep the inertance of the area function: the sections
      // a column overlaps add in series.
      const inertance = (areas) =>
        areas.reduce((sum, area) => sum + 1 / area, 0) / areas.length;
      expect(
        relativeError(inertance(sheet.areas), inertance(shape.areas))
      ).toBeLessThan(1e-9);
    });
  }

  it('lets [l] pass beside the tongue', () => {
    const shape = tractShape(
      consonantTarget({ phoneme: getPhoneme('l') }),
      DEFAULT_HEAD
    );
    expect(shape.lateral).toBe(1);
    const sheet = updateSheet(buildSheet(DEFAULT_HEAD), shape);
    expect(sheet.lateralColumns.length).toBe(3);
    for (const column of sheet.lateralColumns) {
      const depths = columnDepths(sheet, column);
      const third = sheet.width[column] / 6;
      const middle = depths.filter(
        (_, row) => Math.abs(sheet.centers[row]) <= third
      );
      const left = depths.filter((_, row) => sheet.centers[row] < -third);
      const right = depths.filter((_, row) => sheet.centers[row] > third);
      expect(middle.length).toBeGreaterThan(0);
      expect(middle.every((h) => h === 0)).toBe(true);
      expect(left.some((h) => h > 0)).toBe(true);
      expect(right.some((h) => h > 0)).toBe(true);
      const area = depths.reduce((sum, h) => sum + h, 0) * sheet.dx;
      expect(Math.abs(area - sheet.areas[column])).toBeLessThan(1e-9);
    }
    // A central consonant keeps the middle open.
    const central = updateSheet(
      buildSheet(DEFAULT_HEAD),
      tractShape(consonantTarget({ phoneme: getPhoneme('d') }), DEFAULT_HEAD)
    );
    expect(central.lateralColumns.length).toBe(0);
  });
});

describe('2D FDTD resonances', () => {
  it('resonates like a uniform tube', () => {
    const head = { ...DEFAULT_HEAD, vocalTractLength: 17.5 };
    const areas = new Array(44).fill(3);
    const solver = new Fdtd2d({ head, piriform: false, vallecula: false });
    solver.setShape(areas, 0);
    solver.setLength(17.5);
    const peaks = responsePeaks(
      solver,
      1 / solver.stepDuration({ length: 17.5 })
    );
    const reference = tubeFormants(areas, 17.5, { count: 3 });
    for (const target of reference) {
      expect(relativeError(nearest(peaks, target), target)).toBeLessThan(0.03);
    }
  });

  for (const symbol of ['ɑ', 'i', 'u']) {
    it(`/${symbol}/ follows the area function like the waveguide`, () => {
      const shape = vowelShape(symbol);
      const peaks = sheetPeaks(shape, { vallecula: false });
      const reference = waveguidePeaks(shape.areas, shape.length);
      for (const target of reference.slice(0, 3)) {
        expect(relativeError(nearest(peaks, target), target)).toBeLessThan(
          0.05
        );
      }
    });
  }

  it('has the transverse mode of a wide tube, which the waveguide lacks', () => {
    const solver = new Fdtd2d({
      head: DEFAULT_HEAD,
      piriform: false,
      vallecula: false,
    });
    const { columns, rows, dx } = solver;
    const width = rows * dx;
    expect(Math.abs(width - 6)).toBeLessThan(1e-9);
    solver.setDepths(new Float64Array(columns * rows).fill(1));
    const rate = 1 / solver.dt;
    const response = new Float64Array(Math.round(rate * 0.08));
    // Drive one corner at the glottis, listen in the opposite corner at
    // the lips: the first cross mode has a node on the midline.
    const receiver = columns * rows - 1;
    solver.pressure[0] = 1;
    for (let n = 0; n < response.length; n++) {
      solver.step(0, 0, 0);
      response[n] = solver.pressure[receiver];
    }
    const options = { prominence: 1, from: 200, to: 5000 };
    const expected = SPEED_OF_SOUND / (2 * width);
    const peaks = spectralPeaks(response, rate, options);
    expect(relativeError(nearest(peaks, expected), expected)).toBeLessThan(
      0.08
    );
    const tube = new Waveguide({ sections: 44, piriform: false });
    tube.setShape(new Array(44).fill(width), 0);
    tube.setLength(solver.restLength);
    const tubeRate = (44 * SPEED_OF_SOUND) / solver.restLength;
    const tubeResponse = new Float64Array(Math.round(tubeRate * 0.08));
    for (let n = 0; n < tubeResponse.length; n++) {
      tubeResponse[n] = tube.step(n === 0 ? 1 : 0, 0, 0);
    }
    const tubePeaks = spectralPeaks(tubeResponse, tubeRate, options);
    expect(tubePeaks.every((peak) => Math.abs(peak - expected) > 300)).toBe(
      true
    );
  });

  it('runs slower for a longer tract so the formants follow its length', () => {
    const solver = new Fdtd2d({ head: DEFAULT_HEAD });
    const rest = solver.restLength;
    expect(solver.stepDuration({})).toBe(solver.stepDuration());
    expect(solver.stepDuration()).toBe(solver.dt);
    expect(
      relativeError(
        solver.stepDuration({ length: rest * 1.1 }),
        solver.stepDuration() * 1.1
      )
    ).toBeLessThan(1e-12);
    expect(
      relativeError(
        solver.stepDuration({ length: rest * 0.8 }),
        solver.stepDuration() * 0.8
      )
    ).toBeLessThan(1e-12);
  });
});

describe('2D FDTD rendering', () => {
  let renders;
  const measured = () => {
    renders ??= {
      sheet: render({ solver: 'fdtd2d' }),
      medium: render({ tier: 'medium' }),
    };
    return renders;
  };

  /** ˈama and the RMS of 30 ms in the middle of its [m] and first [a]. */
  function render(options) {
    const { samples, sampleRate, plan } = synthesize('ˈama', {
      ipa: true,
      seed: 1,
      ...options,
    });
    const level = (kind) => {
      const segment = plan.segments.find((item) => item.kind === kind);
      const centre = Math.round(
        ((segment.start + segment.end) / 2) * sampleRate
      );
      const half = Math.round(0.015 * sampleRate);
      return rms(samples, centre - half, centre + half);
    };
    return {
      samples,
      ratio: level('consonant') / level('vowel'),
    };
  }

  it('is finite and about as loud as the waveguide', () => {
    const { sheet, medium } = measured();
    expect(sheet.samples.every(Number.isFinite)).toBe(true);
    const decibels = 20 * Math.log10(rms(sheet.samples) / rms(medium.samples));
    expect(Math.abs(decibels)).toBeLessThan(3);
  });

  it('is deterministic', () => {
    const { sheet } = measured();
    const again = render({ solver: 'fdtd2d' }).samples;
    expect(again.length).toBe(sheet.samples.length);
    expect(again.every((value, index) => value === sheet.samples[index])).toBe(
      true
    );
  });

  it('keeps the nasal murmur at the level of the waveguide', () => {
    const { sheet, medium } = measured();
    expect(Math.abs(20 * Math.log10(sheet.ratio / medium.ratio))).toBeLessThan(
      1
    );
  });

  itUnless(NASAL_TARGET_BLOCKED)(
    'keeps the nasal murmur quieter than the vowels',
    () => {
      const { sheet } = measured();
      expect(sheet.ratio).toBeLessThan(1);
    }
  );

  it('exposes the pressure per column and in the nose', () => {
    const solver = new Fdtd2d({ head: DEFAULT_HEAD });
    solver.setNose(noseShape(DEFAULT_HEAD).areas);
    const shape = vowelShape('a');
    solver.setShape(shape.areas, 0.3, shape.velumIndex, null, shape);
    for (let n = 0; n < 200; n++) {
      solver.step(n === 0 ? 1 : 0, 0, 0);
    }
    const field = solver.field();
    expect(field.pressure.length).toBe(solver.columns);
    expect(field.nose.length).toBeGreaterThan(0);
    expect(Array.from(field.pressure).some((value) => value !== 0)).toBe(true);
    solver.reset();
    expect(solver.pressure.every((value) => value === 0)).toBe(true);
  });
});
