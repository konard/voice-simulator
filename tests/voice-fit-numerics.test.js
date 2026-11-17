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
