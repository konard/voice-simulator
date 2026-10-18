/**
 * Lip and nostril radiation of the 1D waveguide, and the waveguide
 * resonances that depend on it.
 */

import { describe, it, expect } from 'test-anywhere';
import { Radiation, RADIATION_RESISTANCE } from '../src/acoustics/radiation.js';
import { Waveguide, piriformBranch } from '../src/acoustics/waveguide.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import {
  SPEED_OF_SOUND,
  tubeFormants,
  tubeTransfer,
} from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const RATE = 100000;

function magnitude({ re, im }) {
  return Math.hypot(re, im);
}

function vowelShape(symbol, head = DEFAULT_HEAD) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    head
  );
}

/** Spectral peaks (Hz) of the waveguide impulse response at `sections`. */
function waveguidePeaks(shape, sections, options = {}) {
  const areas = resample(shape.areas, sections);
  const solver = new Waveguide({ sections, ...options });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(areas, 0);
  solver.setLength(shape.length);
  const rate = (sections * SPEED_OF_SOUND) / shape.length;
  const response = new Float64Array(Math.round(rate * 0.08));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 });
}

/** Linear resampling of an area function to `count` sections. */
function resample(areas, count) {
  return Float64Array.from({ length: count }, (_, index) => {
    const position = ((index + 0.5) * areas.length) / count - 0.5;
    const lower = Math.max(0, Math.floor(position));
    const upper = Math.min(areas.length - 1, lower + 1);
    const fraction = Math.min(1, Math.max(0, position - lower));
    return areas[lower] * (1 - fraction) + areas[upper] * fraction;
  });
}

function nearest(peaks, target) {
  return peaks.reduce((best, peak) =>
    Math.abs(peak - target) < Math.abs(best - target) ? peak : best
  );
}

describe('lip radiation', () => {
  it('reflects everything at low frequencies with inverted sign', () => {
    const radiation = new Radiation();
    radiation.configure(3, RATE);
    const low = radiation.response(1, RATE);
    expect(Math.abs(low.re + 1)).toBeLessThan(1e-3);
    expect(Math.abs(low.im)).toBeLessThan(1e-3);
  });

  it('tends to the resistive reflection at high frequencies', () => {
    const radiation = new Radiation();
    radiation.configure(3, 1e7);
    const high = radiation.response(2e6, 1e7);
    const expected = (RADIATION_RESISTANCE - 1) / (RADIATION_RESISTANCE + 1);
    expect(Math.abs(high.re - expected)).toBeLessThan(0.02);
  });

  it('is passive and lets a wider opening radiate more', () => {
    for (const area of [0.05, 0.5, 3, 8]) {
      const radiation = new Radiation();
      radiation.configure(area, RATE);
      for (let frequency = 50; frequency < RATE / 2; frequency += 997) {
        expect(magnitude(radiation.response(frequency, RATE))).toBeLessThan(
          1 + 1e-9
        );
      }
    }
    const narrow = new Radiation();
    const wide = new Radiation();
    narrow.configure(0.2, RATE);
    wide.configure(5, RATE);
    expect(magnitude(wide.response(2000, RATE))).toBeLessThan(
      magnitude(narrow.response(2000, RATE))
    );
  });

  it('matches its frequency response in the time domain', () => {
    const radiation = new Radiation();
    radiation.configure(2, RATE);
    const frequency = 3000;
    let re = 0;
    let im = 0;
    const count = 20000;
    for (let n = 0; n < count; n++) {
      const output = radiation.process(
        Math.cos((2 * Math.PI * frequency * n) / RATE)
      );
      if (n >= count / 2) {
        const phase = (2 * Math.PI * frequency * n) / RATE;
        re += output * Math.cos(phase);
        im -= output * Math.sin(phase);
      }
    }
    const measured = Math.hypot(re, im) / (count / 4);
    const expected = magnitude(radiation.response(frequency, RATE));
    expect(Math.abs(measured - expected)).toBeLessThan(0.01);
  });
});

describe('waveguide resonances with radiation', () => {
  it('keeps both low formants of /u/', () => {
    const shape = vowelShape('u');
    const [f1, f2] = tubeFormants(shape.areas, shape.length, { count: 2 });
    const peaks = waveguidePeaks(shape, 44, { piriform: false });
    expect(Math.abs(nearest(peaks, f1) - f1) / f1).toBeLessThan(0.08);
    expect(Math.abs(nearest(peaks, f2) - f2) / f2).toBeLessThan(0.05);
  });

  it('gives the same formants for any number of sections', () => {
    for (const symbol of ['ə', 'i', 'u']) {
      const shape = vowelShape(symbol);
      const reference = waveguidePeaks(shape, 88, { piriform: false });
      for (const sections of [32, 44]) {
        const peaks = waveguidePeaks(shape, sections, { piriform: false });
        for (const target of reference.slice(0, 2)) {
          const error = Math.abs(nearest(peaks, target) - target) / target;
          expect(error).toBeLessThan(0.06);
        }
      }
    }
  });

  it('matches the tube model with the piriform fossae as a side branch', () => {
    for (const symbol of ['ə', 'i', 'ɑ', 'u']) {
      const shape = vowelShape(symbol);
      const bare = tubeFormants(shape.areas, shape.length, { count: 3 });
      const fossae = tubeFormants(shape.areas, shape.length, {
        count: 3,
        branches: [piriformBranch(44, shape.length, DEFAULT_HEAD)],
      });
      const peaks = waveguidePeaks(shape, 44);
      fossae.forEach((target, index) => {
        // The blind fossae lower every formant, as in the waveguide.
        expect(target).toBeLessThan(bare[index]);
        const error = Math.abs(nearest(peaks, target) - target) / target;
        expect(error).toBeLessThan(0.03);
      });
    }
  });

  it('puts the antiresonance of a blind side tube at a quarter wavelength', () => {
    const areas = new Array(44).fill(3);
    const branch = { index: 10, area: 1, length: 2 };
    const zero = SPEED_OF_SOUND / (4 * branch.length);
    const level = (frequency) =>
      tubeTransfer(areas, 17, frequency, { branches: [branch] });
    expect(level(zero)).toBeLessThan(0.01 * level(zero * 0.9));
    expect(level(zero)).toBeLessThan(0.01 * level(zero * 1.1));
  });
});
