/** Numerical regression tests of issue 63. Unlicense. */
import { describe, it, expect } from 'test-anywhere';
import { simplex } from '../src/analysis/voice-fit-simplex.js';
import {
  emptyState,
  addValue,
  quantile,
  medianSd,
  tableInverse,
  copyState,
} from '../src/analysis/voice-fit-statistics.js';
import { vectorDistance } from '../src/analysis/voice-fit.js';
import {
  createMcdMetric,
  featureVector,
} from '../src/analysis/voice-fit-objective.js';
import { powerFrames, cepstra } from '../src/metrics/spectrum.js';
import { dtw } from '../src/metrics/dtw.js';
import {
  normalizeRms,
  melCepstralDistortion,
} from '../src/metrics/distortion.js';
const consume = (g) => {
  let next = g.next();
  while (!next.done) {
    next = g.next();
  }
  return next.value;
};
describe('voice fitting numerics', () => {
  it('interpolates histogram order statistics and applies the prescribed MAD SD', () => {
    const s = emptyState();
    for (const x of [900, 900, 1100, 1100]) {
      addValue(s, 'dF', x);
    }
    expect(quantile(s, 'dF')).toBe(1000);
    expect(
      Math.abs(medianSd(s, 'dF') - (1.4826 * 100) / Math.sqrt(4 / 20)) < 1e-9
    ).toBe(true);
    const clone = copyState(s);
    clone.histograms.dF[0]++;
    expect(s.histograms.dF[0]).toBe(0);
    // A bright spectrum can have more high-band energy and negative tilt.
    clone.tilt = -12;
    expect(copyState(JSON.parse(JSON.stringify(clone))).tilt).toBe(-12);
    const even = emptyState();
    for (const x of [600, 900, 1000, 1000]) {
      addValue(even, 'dF', x);
    }
    // Median 950; absolute differences 350, 50, 50, 50 have MAD 50.
    expect(medianSd(even, 'dF')).toBe((1.4826 * 50) / Math.sqrt(4 / 20));
    const mixed = emptyState();
    for (const x of [600, 800, 1000, 1200]) {
      addValue(mixed, 'dF', x);
    }
    // Median 900; deviations 300, 100, 100, 300 interpolate to MAD 200.
    expect(medianSd(mixed, 'dF')).toBe((1.4826 * 200) / Math.sqrt(4 / 20));
  });
  it('bounds evaluations and converges on a coupled objective deterministically', () => {
    const run = (budget) => {
      const calls = [];
      const result = consume(
        simplex(
          [0.9, 0.1],
          (x) => {
            calls.push(x);
            return { cost: 100 * ((x[0] - 0.2) ** 2 + (x[1] - 0.7) ** 2) };
          },
          budget
        )
      );
      return { calls, result };
    };
    for (const budget of [0, 1, 2, 3, 10, 80]) {
      const a = run(budget);
      expect(a.calls.length <= budget).toBe(true);
      expect(a.calls.every((x) => x.every((v) => v >= 0 && v <= 1))).toBe(true);
      expect(a).toEqual(run(budget));
    }
    expect(run(80).result[0].cost < 0.02).toBe(true);
  });
  it('weights centered mel and transcript distortion and skips missing features', () => {
    const a = {
      values: [0, ...Array(11).fill(null), 0],
      scales: Array(13).fill(1),
    };
    const b = { values: [1, ...Array(11).fill(null), 2], scales: a.scales };
    expect(Math.abs(vectorDistance(a, b) - Math.sqrt(2.2 / 1.3)) < 1e-12).toBe(
      true
    );
    expect(
      Math.abs(vectorDistance(a, b, true, 3) - Math.sqrt(41 / 6)) < 1e-12
    ).toBe(true);
    expect(vectorDistance(a, b, true, Infinity)).toBe(Infinity);
    expect(vectorDistance(a, b, true, null)).toBe(Infinity);
  });
  it('converts natural-log mel powers to centered decibels', () => {
    const state = emptyState();
    state.voicedFrames = 2;
    // Two frames with power 100 in one band and power 1 in the others.
    state.mel[0] = 2 * Math.log(100);
    const vector = featureVector(state);
    expect(Math.abs(vector.values[12] - (20 - 20 / 24)) < 1e-12).toBe(true);
    expect(Math.abs(vector.values[13] + 20 / 24) < 1e-12).toBe(true);
    expect(vector.scales[12]).toBe(3);
  });
  it('inverts nonmonotone measured calibration without discarding samples', () => {
    const table = [
      [0, 16],
      [0.25, 18],
      [0.5, 14],
      [1, 6],
    ];
    expect(tableInverse(18, table)).toBe(0.25);
    expect(tableInverse(10, table)).toBe(0.75);
  });
});
describe('voice fitting aligned distortion', () => {
  it('matches the existing metric after alignment and reuses target preparation', () => {
    const rate = 8000;
    const signal = (length, frequency) =>
      Float32Array.from({ length }, (_, i) =>
        i < 400
          ? 0
          : Math.sin((2 * Math.PI * frequency * i) / rate) *
            Math.sin((Math.PI * i) / length)
      );
    const target = signal(4000, 160);
    const compare = createMcdMetric(target, rate);
    for (const candidate of [target, signal(4500, 165), signal(3800, 220)]) {
      const vectors = [target, candidate].map((samples) =>
        cepstra(powerFrames(normalizeRms(samples), rate), rate).map((c) =>
          c.subarray(1)
        )
      );
      const { path } = dtw(...vectors, { band: 0.25 });
      const expected = melCepstralDistortion(target, candidate, rate, { path });
      expect(Math.abs(compare(candidate) - expected) < 1e-10).toBe(true);
      expect(compare(candidate)).toBe(compare(candidate));
    }
  });
});
