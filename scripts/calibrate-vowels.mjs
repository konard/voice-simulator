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
// same area function (the bent, voxelized tract and the open face), and the
// 2D sheet a few per cent lower in F1 (its vallecula), so each gets its own
// table, fitted through the tube model with targets moved by the measured
// solver/tube formant ratios.
//
// Usage: node scripts/calibrate-vowels.mjs [--check] [--solver fdtd3d|fdtd2d] [--dx 0.5] [--vowels i,ɔ]
//   --check   only report the remaining formant errors of the stored table.
//   --solver  tube (default; 1D waveguide), fdtd3d (3D solver table) or
//             fdtd2d (2D sheet table).
//   --dx      cell size of the solver (default 0.5 for 3D, 0.6 for 2D).
//   --vowels  refit only these vowels and keep the stored rows of the others.
//   PENALTY  environment variable, the regularization weight (0.01).
import { readFileSync, writeFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { SHEET_DX } from '../src/acoustics/sheet-model.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import * as TABLES from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  STORY_AREAS,
  STORY_FEATURES,
  VOWEL_LENGTH_SCALE_3D,
} from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

export const REFERENCE_HEAD = presetHeadConfig('male');
const NAMES = Object.keys(STORY_AREAS);
const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const SOLVER = option('--solver', 'tube');
const DX = Number(option('--dx', SOLVER === 'fdtd2d' ? SHEET_DX : 0.5));
const ONLY = option('--vowels', NAMES.join(',')).split(',');
/** Name and cell size of the stored table of each solver. */
const SOLVER_TABLES = {
  fdtd3d: { name: 'VOWEL_CORRECTIONS_3D', label: '3D solver' },
  fdtd2d: { name: 'VOWEL_CORRECTIONS_2D', label: '2D sheet' },
};
const OUTPUT = new URL(
  '../src/articulation/vowel-calibration.js',
  import.meta.url
);
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

function createSolver() {
  if (SOLVER === 'fdtd2d') {
    return new Fdtd2d({ head: REFERENCE_HEAD, dx: DX });
  }
  voxelModel ??= buildVoxelModel(REFERENCE_HEAD, { dx: DX });
  // The source plane follows the length as in voice.js.
  return new Fdtd3d({ model: voxelModel, lengthScale: VOWEL_LENGTH_SCALE_3D });
}

/**
 * F1-F3 (Hz) of a measured vowel in the 3D solver (or the 2D sheet with
 * --solver fdtd2d) at DX: the first three peaks of its impulse response
 * above 150 Hz, at 2 Hz steps.
 */
export function solverFormants(name, corrections) {
  const shape = vowelTract(name, corrections);
  const solver = createSolver();
  solver.setNose(noseShape(REFERENCE_HEAD).areas);
  solver.setShape(
    shape.areas,
    shape.velumArea,
    shape.velumIndex,
    shape.teeth,
    shape
  );
  solver.setLength?.(shape.length);
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
 * Solver fit from `start`: the tube model is fitted to targets moved by
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

/** Length changes (log) tried around a 3D fit, about one and two cells. */
const LENGTH_STEPS = [-0.06, -0.03, 0.03, 0.06];

/**
 * The length moves the 3D source plane by whole cells (issue 40), a step
 * the fit of the smooth tube model cannot see: the fit is tried at a few
 * lengths around it and fitted again from the best of them.
 * @param {string} name
 * @param {{coefficients: number[], error: number}} fit
 */
function searchLength(name, fit) {
  const goal = HILLENBRAND.male[name];
  let best = fit;
  for (const change of LENGTH_STEPS) {
    const coefficients = [...fit.coefficients];
    coefficients[0] = Number((coefficients[0] + change).toFixed(4));
    const solver = solverFormants(name, { [name]: coefficients });
    const error = rmsError(solver, goal);
    if (error < best.error) {
      best = { coefficients, error };
    }
  }
  return best === fit ? fit : fitSolver(name, best.coefficients);
}

/**
 * Corrections for the solver: the better of the fits started from its
 * stored table and from the tube table.
 * @param {string} name
 */
export function calibrateSolver(name) {
  const stored = TABLES[SOLVER_TABLES[SOLVER].name];
  const starts = [stored?.[name], calibrate(name)].filter(
    (start) => start?.length === TERMS
  );
  const fit = starts
    .map((start) => fitSolver(name, [...start]))
    .reduce((best, next) => (next.error < best.error ? next : best));
  return (SOLVER === 'fdtd3d' ? searchLength(name, fit) : fit).coefficients;
}

function report(corrections) {
  const measure = SOLVER in SOLVER_TABLES ? solverFormants : vowelFormants;
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

/** Cell size a stored solver table was fitted at, from its comment. */
function fittedDx(label) {
  const text = readFileSync(OUTPUT, 'utf8');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(
    new RegExp(`For the ${escaped} \\(fitted at ([\\d.]+)`)
  );
  return match ? Number(match[1]) : DX;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = SOLVER_TABLES[SOLVER];
  const stored = target ? TABLES[target.name] : TABLES.VOWEL_CORRECTIONS;
  if (process.argv.includes('--check')) {
    report(stored);
  } else {
    const fit = target ? calibrateSolver : (name) => calibrate(name);
    const corrections = Object.fromEntries(
      NAMES.map((name) => [
        name,
        ONLY.includes(name) ? fit(name) : stored[name],
      ])
    );
    report(corrections);
    const tube = target ? TABLES.VOWEL_CORRECTIONS : corrections;
    const solverTables = Object.entries(SOLVER_TABLES)
      .map(([key, { name, label }]) => {
        const values =
          key === SOLVER
            ? corrections
            : (TABLES[name] ?? TABLES.VOWEL_CORRECTIONS);
        const dx = key === SOLVER ? DX : fittedDx(label);
        return `/** For the ${label} (fitted at ${dx} cm cells). */\n${table(name, values)}`;
      })
      .join('\n');
    writeFileSync(
      OUTPUT,
      `// Generated by scripts/calibrate-vowels.mjs: log length change and log-area
// corrections (cosine series along the tract, glottis to lips, from the
// first order on) of the measured vowels in vowel-space.js, fitted so that
// their resonances on the typical male head, incisors and piriform fossae
// included, match the mean formants of men (vowel-norms.js).

/** For the tube model and the 1D waveguide. */
${table('VOWEL_CORRECTIONS', tube)}
${solverTables}`
    );
  }
}
