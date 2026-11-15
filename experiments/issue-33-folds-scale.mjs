/**
 * Calibrates FOLDS_FLOW_SCALE (issue 33): the RMS of the flow derivative of
 * a steady vowel at 800 Pa and adduction 0.5 against the RMS of the LF
 * source at its defaults (f0 120 Hz, voicing 1, loudness 1), both without
 * noise at 44100 Hz over 0.2 s to 1.2 s.
 *
 * The RMS of the fold source rises with the pitch (each closure gives
 * about the same peak of the derivative, and there are more closures per
 * second); the RMS of the LF source does not. Q = 1 gives 147 Hz with this
 * model, so the scale is set at the tension of the LF pitch, 120 Hz. The
 * table shows the level at other pitches with that scale.
 *
 *   node experiments/issue-33-folds-scale.mjs
 */
import { Glottis } from '../src/acoustics/glottis.js';
import {
  FOLDS_FLOW_SCALE,
  VocalFolds,
  flowPitch,
  tensionForPitch,
} from '../src/acoustics/folds.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const RATE = 44100;
const START = Math.round(0.2 * RATE);
const END = Math.round(1.2 * RATE);

function measure(step, flow) {
  let sum = 0;
  const flows = new Float64Array(END - START);
  for (let index = 0; index < END; index++) {
    const value = step();
    if (index >= START) {
      sum += value * value;
      flows[index - START] = flow();
    }
  }
  return { rms: Math.sqrt(sum / (END - START)), flows };
}

const glottis = new Glottis();
const lf = measure(
  () =>
    glottis.step(
      1 / RATE,
      { f0: 120, voicing: 1, aspiration: 0, closure: 0, loudness: 1 },
      0
    ),
  () => 0
).rms;

function folds(tension) {
  const source = new VocalFolds();
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: 800,
    adduction: 0.5,
    foldTension: tension,
  };
  const { rms, flows } = measure(
    () => source.step(1 / RATE, control, 0),
    () => source.flow
  );
  return { rms, pitch: flowPitch(flows, RATE) };
}

const calibration = folds(tensionForPitch(120, 800, DEFAULT_HEAD));
const raw = calibration.rms / FOLDS_FLOW_SCALE;
console.log(`LF RMS (120 Hz)                 ${lf.toPrecision(5)}`);
console.log(
  `folds raw RMS at ${calibration.pitch.toFixed(1)} Hz (cm³/s²) ${raw.toPrecision(5)}`
);
console.log(`FOLDS_FLOW_SCALE (current)      ${FOLDS_FLOW_SCALE}`);
console.log(`FOLDS_FLOW_SCALE (ideal)        ${(lf / raw).toPrecision(5)}`);
console.log('');
console.log('pitch (Hz)  Q      level against LF (dB)');
for (const f0 of [90, 100, 120, 147, 200, 300]) {
  const tension = f0 === 147 ? 1 : tensionForPitch(f0, 800, DEFAULT_HEAD);
  const { rms, pitch } = folds(tension);
  console.log(
    `${pitch.toFixed(1).padStart(10)}  ${tension.toFixed(3)}  ${(20 * Math.log10(rms / lf)).toFixed(2).padStart(6)}`
  );
}
