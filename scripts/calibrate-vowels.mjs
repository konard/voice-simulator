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
// The 3D solver resonates a few per cent lower than the tube model for the
// same area function (the bent, voxelized tract and the open face), so it
// gets its own table, fitted through the tube model with targets moved by
// the measured 3D/tube formant ratios.
//
// Usage: node scripts/calibrate-vowels.mjs [--check] [--solver fdtd3d] [--dx 0.5]
//   --check   only report the remaining formant errors of the stored table.
//   --solver  tube (default; 1D waveguide) or fdtd3d (3D solver table).
//   PENALTY  environment variable, the regularization weight (0.01).
import { writeFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import * as TABLES from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  STORY_AREAS,
  STORY_FEATURES,
} from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

export const REFERENCE_HEAD = presetHeadConfig('male');
const NAMES = Object.keys(STORY_AREAS);
const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const SOLVER = option('--solver', 'tube');
const DX = Number(option('--dx', 0.5));
const ROUNDS = 4;
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

function vowelTract(name, corrections) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  return tractShape(
    { height, backness, rounding },
    REFERENCE_HEAD,
    corrections && { vowelCorrections: corrections }
  );
}

/** F1-F3 (Hz) of a measured vowel in the tube model with corrections. */
export function vowelFormants(name, corrections) {
  const shape = vowelTract(name, corrections);
  return tubeFormants(shape.areas, shape.length, {
    count: 3,
    maxFrequency: 3600,
    branches: [
      piriformBranch(shape.areas.length, shape.length, REFERENCE_HEAD),
    ],
  });
}

let voxelModel = null;

/**
 * F1-F3 (Hz) of a measured vowel in the 3D solver at DX: the first three
 * peaks of its impulse response above 150 Hz, at 2 Hz steps.
 */
export function solverFormants(name, corrections) {
  voxelModel ??= buildVoxelModel(REFERENCE_HEAD, { dx: DX });
  const shape = vowelTract(name, corrections);
  const solver = new Fdtd3d({ model: voxelModel });
  solver.setNose(noseShape(REFERENCE_HEAD).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  const rate = 1 / solver.stepDuration(shape);
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { step: 2, prominence: 0.5 })
    .filter((value) => value > 150)
    .slice(0, 3);
}

function logErrors(name, coefficients, targets) {
  const formants = vowelFormants(name, { [name]: coefficients });
  return targets.map((target, index) =>
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
function step(name, coefficients, errors, targets) {
  const jacobian = coefficients.map((_, k) => {
    const moved = coefficients.map((value, j) => value + (j === k ? STEP : 0));
    return logErrors(name, moved, targets).map(
      (value, i) => (errors[i] - value) / STEP
    );
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

/**
 * Tube-model corrections of a vowel for F1-F3 targets (Hz), from `start`.
 * @param {string} name
 * @param {number[]} [targets]
 * @param {number[]} [start]
 */
export function calibrate(
  name,
  targets = HILLENBRAND.male[name],
  start = new Array(TERMS).fill(0)
) {
  let coefficients = [...start];
  let errors = logErrors(name, coefficients, targets);
  for (let iteration = 0; iteration < 40; iteration++) {
    const next = step(name, coefficients, errors, targets);
    const nextErrors = logErrors(name, next, targets);
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

/** RMS log error (natural log) of formants against F1-F3 targets. */
function rmsError(formants, targets) {
  return Math.sqrt(
    targets.reduce(
      (sum, target, index) =>
        sum + Math.log(target / (formants[index] ?? Infinity)) ** 2,
      0
    ) / targets.length
  );
}

/**
 * 3D solver fit from `start`: the tube model is fitted to targets moved by
 * the ratio of its formants to the solver's for the current corrections,
 * which converges in a few rounds because that ratio changes slowly. The
 * round the solver itself matches best is kept, so a round that locks onto
 * a different peak cannot make the fit worse.
 * @param {string} name
 * @param {number[]} start
 */
function fitSolver(name, start) {
  const goal = HILLENBRAND.male[name];
  let coefficients = start;
  let best = { coefficients, error: Infinity };
  for (let round = 0; round <= ROUNDS; round++) {
    const corrections = { [name]: coefficients };
    const solver = solverFormants(name, corrections);
    const error = rmsError(solver, goal);
    if (error < best.error) {
      best = { coefficients, error };
    }
    if (round === ROUNDS || solver.length < goal.length) {
      break;
    }
    const tube = vowelFormants(name, corrections);
    const targets = goal.map(
      (target, index) => (target * tube[index]) / solver[index]
    );
    coefficients = calibrate(name, targets, coefficients);
  }
  return best;
}

/**
 * Corrections for the 3D solver: the better of the fits started from the
 * stored 3D table and from the tube table.
 * @param {string} name
 */
export function calibrateSolver(name) {
  const starts = [TABLES.VOWEL_CORRECTIONS_3D?.[name], calibrate(name)].filter(
    (start) => start?.length === TERMS
  );
  return starts
    .map((start) => fitSolver(name, [...start]))
    .reduce((best, fit) => (fit.error < best.error ? fit : best)).coefficients;
}

function report(corrections) {
  const measure = SOLVER === 'fdtd3d' ? solverFormants : vowelFormants;
  for (const name of NAMES) {
    const raw = measure(name, {}).map(Math.round);
    const fitted = measure(name, corrections).map(Math.round);
    console.log(
      `/${name}/ target ${HILLENBRAND.male[name].join(' ')} | raw ${raw.join(' ')} | calibrated ${fitted.join(' ')}`
    );
  }
}

function table(name, corrections) {
  const body = Object.entries(corrections)
    .map(([vowel, values]) => `  ${vowel}: [${values.join(', ')}],`)
    .join('\n');
  return `export const ${name} = Object.freeze({\n${body}\n});\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stored =
    SOLVER === 'fdtd3d'
      ? TABLES.VOWEL_CORRECTIONS_3D
      : TABLES.VOWEL_CORRECTIONS;
  if (process.argv.includes('--check')) {
    report(stored);
  } else {
    const fit =
      SOLVER === 'fdtd3d' ? calibrateSolver : (name) => calibrate(name);
    const corrections = Object.fromEntries(
      NAMES.map((name) => [name, fit(name)])
    );
    report(corrections);
    const tube = SOLVER === 'fdtd3d' ? TABLES.VOWEL_CORRECTIONS : corrections;
    const solver =
      SOLVER === 'fdtd3d'
        ? corrections
        : (TABLES.VOWEL_CORRECTIONS_3D ?? TABLES.VOWEL_CORRECTIONS);
    writeFileSync(
      new URL('../src/articulation/vowel-calibration.js', import.meta.url),
      `// Generated by scripts/calibrate-vowels.mjs: log length change and log-area
// corrections (cosine series along the tract, glottis to lips, from the
// first order on) of the measured vowels in vowel-space.js, fitted so that
// their resonances on the typical male head, incisors and piriform fossae
// included, match the mean formants of men (vowel-norms.js).

/** For the tube model and the 1D waveguide. */
${table('VOWEL_CORRECTIONS', tube)}
/** For the 3D solver (fitted at ${SOLVER === 'fdtd3d' ? DX : 'dx'} cm cells). */
${table('VOWEL_CORRECTIONS_3D', solver)}`
    );
  }
}
