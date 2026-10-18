#!/usr/bin/env node
// Fit the corrections of the measured vowels so that the tract the
// synthesizer builds for each of them (incisors and piriform fossae included,
// on the typical male preset head) resonates at the mean formants of the men
// in Hillenbrand et al. (1995), and write them to
// src/articulation/vowel-calibration.js.
//
// The correction is a log length change plus a short cosine series of the
// log area along the tract, fitted by regularized Gauss-Newton steps with a
// numerical Jacobian of the tube-model formants. The penalty keeps every
// section within about a factor of two of the measured area and leaves a few
// per cent of formant error where matching it would need a deformed tract.
//
// Usage: node scripts/calibrate-vowels.mjs [--check]
//   --check  only report the remaining formant errors of the stored table.
//   PENALTY  environment variable, the regularization weight (0.01).
import { writeFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { VOWEL_CORRECTIONS } from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  STORY_AREAS,
  STORY_FEATURES,
} from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

export const REFERENCE_HEAD = presetHeadConfig('male');
const NAMES = Object.keys(STORY_AREAS);
const TERMS = 8;
const STEP = 0.02;
const TOLERANCE = 0.001;
const LIMIT = 1;
/**
 * Tikhonov weights: a log length change of 0.05 costs as much as a cosine
 * term of order k of 0.05 (k + 1) / 2, so smooth area changes and small
 * length changes are preferred over a perfect fit.
 */
const PENALTY = Number(process.env.PENALTY ?? 0.01);
const WEIGHTS = Array.from({ length: TERMS }, (_, k) =>
  k === 0 ? 2 : (1 + k) / 2
);

/** F1-F3 (Hz) of a measured vowel with a set of corrections. */
export function vowelFormants(name, corrections) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  const shape = tractShape(
    { height, backness, rounding },
    REFERENCE_HEAD,
    corrections && { vowelCorrections: corrections }
  );
  return tubeFormants(shape.areas, shape.length, {
    count: 3,
    maxFrequency: 3600,
    branches: [
      piriformBranch(shape.areas.length, shape.length, REFERENCE_HEAD),
    ],
  });
}

function logErrors(name, coefficients) {
  const formants = vowelFormants(name, { [name]: coefficients });
  return HILLENBRAND.male[name].map((target, index) =>
    Math.log(target / (formants[index] ?? Infinity))
  );
}

function solve(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < size; row++) {
      if (row !== column) {
        const factor = rows[row][column] / rows[column][column];
        for (let k = column; k <= size; k++) {
          rows[row][k] -= factor * rows[column][k];
        }
      }
    }
  }
  return rows.map((row, index) => row[size] / row[index]);
}

/**
 * Gauss-Newton step on the formant errors plus the penalty
 * PENALTY * |WEIGHTS * coefficients|^2.
 */
function step(name, coefficients, errors) {
  const jacobian = coefficients.map((_, k) => {
    const moved = coefficients.map((value, j) => value + (j === k ? STEP : 0));
    return logErrors(name, moved).map((value, i) => (errors[i] - value) / STEP);
  });
  const normal = coefficients.map((_, a) =>
    coefficients.map(
      (__, b) =>
        jacobian[a].reduce((sum, value, i) => sum + value * jacobian[b][i], 0) +
        (a === b ? PENALTY * WEIGHTS[a] ** 2 : 0)
    )
  );
  const gradient = jacobian.map(
    (column, k) =>
      column.reduce((sum, value, i) => sum + value * errors[i], 0) -
      PENALTY * WEIGHTS[k] ** 2 * coefficients[k]
  );
  const delta = solve(normal, gradient);
  return coefficients.map((value, k) =>
    Math.max(-LIMIT, Math.min(LIMIT, value + delta[k]))
  );
}

export function calibrate(name) {
  let coefficients = new Array(TERMS).fill(0);
  let errors = logErrors(name, coefficients);
  for (let iteration = 0; iteration < 40; iteration++) {
    const next = step(name, coefficients, errors);
    const nextErrors = logErrors(name, next);
    if (!nextErrors.every(Number.isFinite)) {
      break;
    }
    const change = Math.max(
      ...next.map((value, k) => Math.abs(value - coefficients[k]))
    );
    coefficients = next;
    errors = nextErrors;
    if (change < TOLERANCE) {
      break;
    }
  }
  return coefficients.map((value) => Number(value.toFixed(4)));
}

function report(corrections) {
  for (const name of NAMES) {
    const raw = vowelFormants(name, {}).map(Math.round);
    const fitted = vowelFormants(name, corrections).map(Math.round);
    console.log(
      `/${name}/ target ${HILLENBRAND.male[name].join(' ')} | raw ${raw.join(' ')} | calibrated ${fitted.join(' ')}`
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    report(VOWEL_CORRECTIONS);
  } else {
    const corrections = Object.fromEntries(
      NAMES.map((name) => [name, calibrate(name)])
    );
    report(corrections);
    const body = Object.entries(corrections)
      .map(([name, values]) => `  ${name}: [${values.join(', ')}],`)
      .join('\n');
    writeFileSync(
      new URL('../src/articulation/vowel-calibration.js', import.meta.url),
      `// Generated by scripts/calibrate-vowels.mjs: log length change and log-area
// corrections (cosine series along the tract, glottis to lips, from the
// first order on) of the measured vowels in
// vowel-space.js, fitted so that their resonances on the typical male head,
// incisors and piriform fossae included, match the mean formants of men
// (vowel-norms.js).
export const VOWEL_CORRECTIONS = Object.freeze({
${body}
});
`
    );
  }
}
