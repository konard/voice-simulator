/**
 * Onset of the fold oscillation (issue 33): for adductions and lung
 * pressures, the time from rest until the flow reaches half of its steady
 * peak-to-peak value (Q = 1, 44100 Hz, constant controls, no noise).
 *
 *   node experiments/issue-33-folds-onset.mjs
 */
import { VocalFolds } from '../src/acoustics/folds.js';

const RATE = 44100;
const DURATION = 0.6;
const WINDOW = Math.round(0.005 * RATE);

function onset(pressure, adduction) {
  const folds = new VocalFolds();
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: pressure,
    adduction,
    foldTension: 1,
  };
  const flow = new Float64Array(Math.round(DURATION * RATE));
  for (let index = 0; index < flow.length; index++) {
    folds.step(1 / RATE, control, 0);
    flow[index] = folds.flow;
  }
  const range = (from, to) => {
    let low = Infinity;
    let high = -Infinity;
    for (let index = from; index < to; index++) {
      low = Math.min(low, flow[index]);
      high = Math.max(high, flow[index]);
    }
    return high - low;
  };
  const steady = range(flow.length - Math.round(0.1 * RATE), flow.length);
  if (steady < 1) {
    return '   -  ';
  }
  for (let start = 0; start + WINDOW <= flow.length; start += WINDOW) {
    if (range(start, start + WINDOW * 2) >= steady / 2) {
      return `${((start / RATE) * 1000).toFixed(0).padStart(4)}ms`;
    }
  }
  return '   ?  ';
}

const pressures = [200, 300, 400, 500, 600, 800, 1200];
console.log(
  `adduction  ${pressures.map((p) => `${p} Pa`.padStart(7)).join(' ')}`
);
for (const adduction of [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.8]) {
  const row = pressures.map((p) => onset(p, adduction).padStart(7));
  console.log(`${adduction.toFixed(2).padStart(9)}  ${row.join(' ')}`);
}
