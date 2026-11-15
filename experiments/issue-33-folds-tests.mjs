/**
 * Prints the values that tests/folds.test.js bounds and that
 * experiments/issue-11-folds.mjs does not print: the level gain from 800 to
 * 1600 Pa, the start and stop times, the pitch at 44100 and 88200 Hz and
 * the pitch that tensionForPitch reaches.
 *
 * Run: node experiments/issue-33-folds-tests.mjs > experiments/issue-33-folds-tests.txt
 */
import {
  FOLD_RATE,
  VocalFolds,
  flowPitch,
  foldPitch,
  tensionForPitch,
} from '../src/acoustics/folds.js';

function simulate({
  pressure = 800,
  rate = FOLD_RATE,
  duration = 0.4,
  schedule,
} = {}) {
  const folds = new VocalFolds({ rate });
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: pressure,
    adduction: 0.5,
    foldTension: 1,
  };
  const length = Math.round(duration * rate);
  const flow = new Float64Array(length);
  const source = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    if (schedule) {
      control.lungPressure = schedule(index / rate);
    }
    source[index] = folds.step(1 / rate, control, 0);
    flow[index] = folds.flow;
  }
  return { flow, source };
}

const last = (values, count) => values.subarray(values.length - count);
const peakToPeak = (values) => Math.max(...values) - Math.min(...values);
const rms = (values) =>
  Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) / values.length
  );
const RATE = FOLD_RATE;
const window = Math.round(0.1 * RATE);

const gain =
  20 *
  Math.log10(
    rms(last(simulate({ pressure: 1600 }).source, window)) /
      rms(last(simulate().source, window))
  );
console.log(`RMS of the source, 1600 Pa against 800 Pa: ${gain.toFixed(2)} dB`);

const stop = 0.3;
const run = simulate({ schedule: (time) => (time < stop ? 800 : 0) });
const steady = peakToPeak(
  run.flow.subarray(Math.round((stop - 0.1) * RATE), Math.round(stop * RATE))
);
const width = Math.round(0.01 * RATE);
let start = -1;
for (let index = 0; index < run.flow.length && start < 0; index++) {
  const swing = peakToPeak(
    run.flow.subarray(Math.max(0, index - width + 1), index + 1)
  );
  if (swing >= 0.5 * steady) {
    start = index;
  }
}
console.log(
  `Half of the steady peak-to-peak flow (10 ms window) after ${((start / RATE) * 1000).toFixed(1)} ms`
);
for (const delay of [0.01, 0.02, 0.03, 0.04]) {
  const after = run.flow.subarray(Math.round((stop + delay) * RATE));
  const largest = Math.max(...after.map(Math.abs));
  console.log(
    `Largest flow from ${delay * 1000} ms after the stop: ${((100 * largest) / steady).toFixed(3)} % of the steady peak-to-peak`
  );
}

const coarse = flowPitch(last(simulate().flow, window), RATE);
const fine = flowPitch(
  last(simulate({ rate: 2 * RATE }).flow, 2 * window),
  2 * RATE
);
console.log(
  `Pitch at ${RATE} Hz: ${coarse.toFixed(2)} Hz, at ${2 * RATE} Hz: ${fine.toFixed(2)} Hz (${((100 * (fine - coarse)) / coarse).toFixed(3)} %)`
);

for (const f0 of [90, 120, 200, 300]) {
  const tension = tensionForPitch(f0, 800);
  const pitch = foldPitch(800, tension, {}, { duration: 0.4 });
  console.log(
    `tensionForPitch(${f0}, 800) = ${tension.toFixed(4)} -> ${pitch.toFixed(2)} Hz (${((100 * (pitch - f0)) / f0).toFixed(2)} %)`
  );
}
