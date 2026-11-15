/**
 * The two-mass fold source (src/acoustics/folds.js): it starts by itself
 * above a threshold pressure, its pitch follows the tension, its open
 * quotient the adduction, and its level the lung pressure. Every run uses
 * constant controls and no noise at 44100 Hz; the numbers are measured by
 * experiments/issue-11-folds.mjs.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  FOLD_RATE,
  VocalFolds,
  flowPitch,
  foldPitch,
  tensionForPitch,
} from '../src/acoustics/folds.js';

const RATE = FOLD_RATE;

/**
 * Runs the folds with constant controls; `schedule(time)` may change the
 * lung pressure. Returns the flow and the returned source per sample.
 */
function simulate(options = {}) {
  const rate = options.rate ?? RATE;
  const folds = new VocalFolds({ rate });
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: options.pressure ?? 800,
    adduction: options.adduction ?? 0.5,
    foldTension: options.tension ?? 1,
  };
  const length = Math.round((options.duration ?? 0.4) * rate);
  const flow = new Float64Array(length);
  const area = new Float64Array(length);
  const source = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    if (options.schedule) {
      control.lungPressure = options.schedule(index / rate);
    }
    source[index] = folds.step(1 / rate, control, 0);
    flow[index] = folds.flow;
    area[index] = folds.area;
  }
  return { flow, area, source, rate };
}

/** The last `duration` seconds of a run. */
function tail(values, duration, rate = RATE) {
  return values.subarray(values.length - Math.round(duration * rate));
}

function peakToPeak(values) {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return high - low;
}

function rootMeanSquare(values) {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum / values.length);
}

function steadyPitch(options) {
  const run = simulate(options);
  return flowPitch(tail(run.flow, 0.1, run.rate), run.rate);
}

/** Share of whole periods (upward crossings of U - mean) with a_min > 0. */
function openQuotient(flow, area) {
  const mean = flow.reduce((sum, value) => sum + value, 0) / flow.length;
  let first = -1;
  let last = -1;
  for (let index = 1; index < flow.length; index++) {
    if (flow[index - 1] < mean && flow[index] >= mean) {
      if (first < 0) {
        first = index;
      }
      last = index;
    }
  }
  let open = 0;
  for (let index = first; index < last; index++) {
    if (area[index] > 0) {
      open++;
    }
  }
  return open / (last - first);
}

/** Lowest pressure in steps of 25 Pa whose flow still oscillates after 0.3 s. */
function phonationThreshold() {
  const reference = peakToPeak(tail(simulate().flow, 0.1));
  for (let pressure = 25; pressure <= 2000; pressure += 25) {
    const flow = tail(simulate({ pressure }).flow, 0.1);
    if (peakToPeak(flow) >= 0.01 * reference) {
      return pressure;
    }
  }
  return Number.NaN;
}

/** Peak-to-peak flow of every window of `size` seconds ending at a sample. */
function runningPeakToPeak(flow, size) {
  const width = Math.round(size * RATE);
  return Array.from({ length: flow.length }, (_, index) =>
    peakToPeak(flow.subarray(Math.max(0, index - width + 1), index + 1))
  );
}

describe('vocal folds', () => {
  it('oscillates at conversational lung pressure and not far below it', () => {
    const loud = simulate();
    const pitch = flowPitch(tail(loud.flow, 0.1), RATE);
    expect(pitch).toBeGreaterThan(90);
    expect(pitch).toBeLessThan(160);
    const reference = peakToPeak(tail(loud.flow, 0.1));
    const quiet = peakToPeak(tail(simulate({ pressure: 100 }).flow, 0.1));
    expect(quiet).toBeLessThan(0.01 * reference);
  });

  it('has a phonation threshold in the human range', () => {
    const threshold = phonationThreshold();
    expect(threshold).toBeGreaterThanOrEqual(150);
    expect(threshold).toBeLessThanOrEqual(600);
  });

  it('raises the pitch with tension', () => {
    const pitches = [0.5, 1, 2, 4].map((tension) => steadyPitch({ tension }));
    for (let index = 1; index < pitches.length; index++) {
      expect(pitches[index]).toBeGreaterThan(pitches[index - 1]);
    }
    const ratio = pitches[2] / pitches[1];
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.4);
  });

  it('goes from breathy to pressed with adduction', () => {
    const quotients = [0.3, 0.5, 0.7, 0.9].map((adduction) => {
      const run = simulate({ adduction });
      return openQuotient(tail(run.flow, 0.1), tail(run.area, 0.1));
    });
    for (let index = 1; index < quotients.length; index++) {
      expect(quotients[index]).toBeLessThan(quotients[index - 1]);
    }
    expect(quotients[0]).toBeGreaterThan(0.7);
    expect(quotients[0] - quotients[3]).toBeGreaterThanOrEqual(0.15);
  });

  it('gets louder with lung pressure', () => {
    const level = (pressure) =>
      rootMeanSquare(tail(simulate({ pressure }).source, 0.1));
    const gain = 20 * Math.log10(level(1600) / level(800));
    expect(gain).toBeGreaterThan(4);
    expect(gain).toBeLessThan(12);
  });

  it('starts and stops by itself', () => {
    const stop = 0.3;
    const run = simulate({
      duration: 0.4,
      schedule: (time) => (time < stop ? 800 : 0),
    });
    const steady = peakToPeak(
      run.flow.subarray(
        Math.round((stop - 0.1) * RATE),
        Math.round(stop * RATE)
      )
    );
    // A window of 10 ms holds at least one period above 100 Hz.
    const swing = runningPeakToPeak(run.flow, 0.01);
    const start = swing.findIndex((value) => value >= 0.5 * steady) / RATE;
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThanOrEqual(0.06);
    const after = run.flow.subarray(Math.round((stop + 0.04) * RATE));
    expect(Math.max(...after.map(Math.abs))).toBeLessThan(0.05 * steady);
  });

  it('does not depend on the step size', () => {
    const coarse = steadyPitch({ rate: RATE });
    const fine = steadyPitch({ rate: 2 * RATE });
    expect(Math.abs(fine / coarse - 1)).toBeLessThan(0.01);
  });

  it('finds the tension for a pitch', () => {
    for (const f0 of [90, 120, 200, 300]) {
      const tension = tensionForPitch(f0, 800);
      const pitch = foldPitch(800, tension, {}, { duration: 0.4 });
      expect(Math.abs(pitch / f0 - 1)).toBeLessThan(0.03);
    }
  });
});
