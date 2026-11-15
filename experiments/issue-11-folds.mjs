/**
 * Measures the two-mass fold source (src/acoustics/folds.js) of the default
 * head with constant controls and no noise, at 44100 Hz:
 * - the phonation threshold: the lowest lung pressure in steps of 25 Pa at
 *   which the flow still oscillates after 0.3 s. "Oscillates" means that the
 *   peak-to-peak flow in 0.3 to 0.4 s is at least 1 % of the value at
 *   800 Pa, the bound that tests/folds.test.js uses for "silent" at 100 Pa;
 *   the smallest pressure with any lasting oscillation is printed as well;
 * - the pitch for the tension Q 0.5, 1, 2 and 4 at 800 Pa;
 * - the open quotient (share of whole periods with a_min > 0) and H1-H2 of
 *   the flow derivative for the adduction 0.3, 0.5, 0.7 and 0.9 at 800 Pa
 *   and Q = 1.
 *
 * Run: node experiments/issue-11-folds.mjs > experiments/issue-11-folds.txt
 */
import { DEFAULT_HEAD } from '../src/head-config.js';
import { harmonicLevel } from '../src/acoustics/analysis.js';
import { FOLD_RATE, VocalFolds, flowPitch } from '../src/acoustics/folds.js';

const RATE = FOLD_RATE;
const DURATION = 0.4;
const WINDOW = 0.1;

function simulate({ pressure = 800, tension = 1, adduction = 0.5 } = {}) {
  const folds = new VocalFolds({ ...DEFAULT_HEAD, rate: RATE });
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: pressure,
    adduction,
    foldTension: tension,
  };
  const length = Math.round(DURATION * RATE);
  const flow = new Float64Array(length);
  const area = new Float64Array(length);
  const derivative = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    derivative[index] = folds.step(1 / RATE, control, 0);
    flow[index] = folds.flow;
    area[index] = folds.area;
  }
  const start = length - Math.round(WINDOW * RATE);
  return {
    flow: flow.subarray(start),
    area: area.subarray(start),
    derivative: derivative.subarray(start),
  };
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

/** Upward crossings of U - mean(U), as sample indices. */
function crossings(flow) {
  const mean = flow.reduce((sum, value) => sum + value, 0) / flow.length;
  const result = [];
  for (let index = 1; index < flow.length; index++) {
    if (flow[index - 1] < mean && flow[index] >= mean) {
      result.push(index);
    }
  }
  return result;
}

function openQuotient({ flow, area }) {
  const marks = crossings(flow);
  if (marks.length < 2) {
    return Number.NaN;
  }
  let open = 0;
  for (let index = marks[0]; index < marks.at(-1); index++) {
    if (area[index] > 0) {
      open++;
    }
  }
  return open / (marks.at(-1) - marks[0]);
}

const fixed = (value, digits) => value.toFixed(digits);
const reference = peakToPeak(simulate().flow);
console.log(`Fold source of the default head, ${RATE} Hz, no noise`);
console.log(
  `Peak-to-peak flow at 800 Pa, Q = 1, adduction 0.5: ${fixed(reference, 1)} cm³/s`
);
console.log('');
console.log(
  'Pressure (Pa)  p2p 0.3-0.4 s (share of 800 Pa)  p2p 0.3-0.35 s / 0.35-0.4 s'
);
let threshold = Number.NaN;
let onset = Number.NaN;
for (let pressure = 0; pressure <= 600; pressure += 25) {
  const { flow } = simulate({ pressure });
  const share = peakToPeak(flow) / reference;
  const half = flow.length / 2;
  const early = peakToPeak(flow.subarray(0, half));
  const late = peakToPeak(flow.subarray(half));
  const growth = early > 0 ? late / early : 0;
  if (Number.isNaN(onset) && share > 0 && growth > 0.99) {
    onset = pressure;
  }
  if (Number.isNaN(threshold) && share >= 0.01) {
    threshold = pressure;
  }
  console.log(
    `${String(pressure).padStart(13)}  ${share.toExponential(2).padStart(30)}  ${fixed(growth, 3).padStart(27)}`
  );
}
console.log('');
console.log(`Phonation threshold (p2p >= 1 % of 800 Pa): ${threshold} Pa`);
console.log(`Smallest pressure with a lasting oscillation: ${onset} Pa`);
console.log('');
console.log('Q    pitch at 800 Pa (Hz)');
const pitches = [];
for (const tension of [0.5, 1, 2, 4]) {
  const pitch = flowPitch(simulate({ tension }).flow, RATE);
  pitches.push(pitch);
  console.log(`${String(tension).padEnd(4)} ${fixed(pitch, 1)}`);
}
console.log(`pitch(2) / pitch(1) = ${fixed(pitches[2] / pitches[1], 3)}`);
console.log('');
console.log('Adduction  open quotient  H1-H2 (dB)  pitch (Hz)');
for (const adduction of [0.3, 0.5, 0.7, 0.9]) {
  const result = simulate({ adduction });
  const pitch = flowPitch(result.flow, RATE);
  const options = { duration: WINDOW, search: 0.01 };
  const h1 = harmonicLevel(result.derivative, RATE, pitch, options);
  const h2 = harmonicLevel(result.derivative, RATE, 2 * pitch, options);
  console.log(
    `${String(adduction).padEnd(9)}  ${fixed(openQuotient(result), 3).padStart(13)}  ${fixed(h1 - h2, 2).padStart(10)}  ${fixed(pitch, 1).padStart(10)}`
  );
}
