// Formants of the eleven measured vowels (STORY_LENGTHS) in the 2D FDTD
// sheet (issue 37) against the 1D waveguide and the mean formants of men,
// each solver with its own vowel table (VOWEL_CORRECTIONS_2D for the sheet,
// VOWEL_CORRECTIONS for the waveguide; TABLE=tube gives the sheet the
// waveguide's table, which is how the need for its own table was found).
// Adapted from experiments/fdtd-formants.mjs: besides the LPC formants of a
// rendered sustained vowel it reads F1-F3 from the impulse response of the
// static tract on the male reference head of scripts/calibrate-vowels.mjs,
// as the calibration does.
// Usage: node experiments/issue-11-fdtd2d-formants.mjs [dx]
import { performance } from 'node:perf_hooks';
import { planUtterance } from '../src/articulation/plan.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import {
  estimateFormants,
  rms,
  spectralPeaks,
} from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import {
  VOWEL_CORRECTIONS,
  VOWEL_CORRECTIONS_2D,
} from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  STORY_FEATURES,
  STORY_LENGTHS,
} from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.6);
const rate = 24000;
const head = presetHeadConfig('male');
const nose = noseShape(head).areas;
const sheetTable =
  process.env.TABLE === 'tube' ? VOWEL_CORRECTIONS : VOWEL_CORRECTIONS_2D;

function vowelTract(name, vowelCorrections) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  return tractShape({ height, backness, rounding }, head, {
    vowelCorrections,
  });
}

/** F1-F3: the first three impulse-response peaks above 150 Hz. */
function peaks(solver, stepRate) {
  const response = new Float64Array(Math.round(stepRate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, stepRate, { step: 2, prominence: 0.5 })
    .filter((value) => value > 150)
    .slice(0, 3);
}

function sheetFormants(shape) {
  const solver = new Fdtd2d({ head, dx });
  solver.setNose(nose);
  solver.setShape(
    shape.areas,
    shape.velumArea,
    shape.velumIndex,
    shape.teeth,
    shape
  );
  solver.setLength(shape.length);
  return peaks(solver, 1 / solver.stepDuration(shape));
}

function waveguideFormants(shape) {
  const solver = new Waveguide({ sections: shape.areas.length, head });
  solver.setNose(nose);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex);
  solver.setLength(shape.length);
  return peaks(solver, (shape.areas.length * SPEED_OF_SOUND) / shape.length);
}

const percent = (value, target) => (100 * (value - target)) / target;
const format = (values) =>
  values
    .map((value) => String(Math.round(value)).padStart(5))
    .join('')
    .padEnd(16);

console.log(
  `dx ${dx} cm, male reference head, sheet table ${sheetTable === VOWEL_CORRECTIONS ? 'tube (VOWEL_CORRECTIONS)' : 'VOWEL_CORRECTIONS_2D'}`
);
console.log(
  'vowel  2D F1-F3        waveguide       men (target)    2D-wg %          2D-men %         LPC 2D          LPC wg          rms 2D/wg  x realtime'
);
let worst = 0;
const errors = [];
for (const name of Object.keys(STORY_LENGTHS)) {
  // Each solver with its own vowel table, as in synthesis (voice.js).
  const sheet = sheetFormants(vowelTract(name, sheetTable));
  const wave = waveguideFormants(vowelTract(name, VOWEL_CORRECTIONS));
  const target = HILLENBRAND.male[name];
  const toWave = sheet.map((value, index) => percent(value, wave[index]));
  const toTarget = sheet.map((value, index) => percent(value, target[index]));
  worst = Math.max(worst, ...toWave.map(Math.abs));
  errors.push(...toTarget.map(Math.abs));
  // Sustained vowel through the whole synthesizer, as fdtd-formants.mjs.
  const plan = planUtterance(`ˈ${name}ː`);
  const start = performance.now();
  const rendered = renderPlan(plan, { sampleRate: rate, solver: 'fdtd2d', dx });
  const elapsed = (performance.now() - start) / 1000;
  const reference = renderPlan(plan, { sampleRate: rate });
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const window = { start: middle - 0.03, duration: 0.06, count: 3 };
  const range = [Math.floor(vowel.start * rate), Math.floor(vowel.end * rate)];
  console.log(
    `/${name}/`.padEnd(7),
    format(sheet),
    format(wave),
    format(target),
    toWave.map((value) => value.toFixed(1).padStart(5)).join(' '),
    '',
    toTarget.map((value) => value.toFixed(1).padStart(5)).join(' '),
    '',
    format(estimateFormants(rendered, rate, window)),
    format(estimateFormants(reference, rate, window)),
    (rms(rendered, ...range) / rms(reference, ...range)).toFixed(2).padEnd(10),
    (plan.duration / elapsed).toFixed(2)
  );
}
const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
console.log(`largest |2D - waveguide| ${worst.toFixed(1)} %`);
console.log(`mean |2D - men| ${mean.toFixed(1)} %`);
