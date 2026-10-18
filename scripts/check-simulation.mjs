#!/usr/bin/env node
/**
 * Heavy simulation checks that run in CI only (the unit tests use coarse
 * grids so they stay fast on development machines).
 *
 *   1. Every language sample sentence is synthesized with every audio tier
 *      up to `--max-tier` and saved as WAV for listening.
 *   2. The 3D FDTD solver on the fine `--dx` grid, with its own vowel table,
 *      resonates at the mean formants of men for the measured vowels.
 *   3. Random heads stay stable, the waveguide keeps the tube-model
 *      resonances of /ə/ and /i/ for each head, and the 3D solver, each
 *      solver with its own vowel table, keeps those of the waveguide.
 *   4. All audio tiers are benchmarked on the runner.
 *
 * Usage:
 *   node scripts/check-simulation.mjs [--out dir] [--dx 0.6] [--max-tier high]
 *     [--heads 24] [--verbose]
 *
 * Writes `<out>/report.json`, the WAV files, and a Markdown summary to
 * `$GITHUB_STEP_SUMMARY` when it is set. Exits with 1 when a check fails.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  AUDIO_TIERS,
  Fdtd3d,
  LANGUAGES,
  buildVoxelModel,
  encodeWav,
  getPhoneme,
  measureAudioTier,
  noseShape,
  planUtterance,
  presetHeadConfig,
  randomHeadConfig,
  renderPlan,
  rms,
  spectralPeaks,
  synthesize,
  tractShape,
  tubeFormants,
  Waveguide,
} from '../src/index.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';

/**
 * The 3D solver has its own vowel table (scripts/calibrate-vowels.mjs),
 * fitted with the bent tract, the piriform fossae and the open face that a
 * straight tube lacks, so its reference is what that table is fitted to:
 * the mean formants of men on the typical male head. At 0.6 cm every F1 and
 * F2 lies within 10% of them (experiments/issue-9-ci-resonances.mjs).
 */
const REFERENCE_HEAD = presetHeadConfig('male');
const RESONANCE_VOWELS = Object.keys(STORY_FEATURES).filter(
  (name) => HILLENBRAND.male[name]
);
/** Allowed relative error of the 3D F1 and F2 against the measured means. */
const RESONANCE_TOLERANCE = 0.15;
/** Spectral peaks weaker than this (dB below the strongest) are ignored. */
const PEAK_FLOOR = 12;
/**
 * Vowels and tolerances of the random-head check. Over 100 random heads the
 * /ə/ and /i/ resonances stay within 11% of the tube model in the waveguide
 * (experiments/random-head-resonances.mjs). The 3D solver with its own
 * vowel table, on the 0.6 cm grid, stays within 10% of the waveguide with
 * the tube table (25 heads, experiments/issue-9-ci-heads.mjs), so a vowel
 * sounds alike whichever solver renders it. On the 1 cm grid the
 * incisors and the lips can share one row of cells, and /i/ F1 of some
 * heads drops by up to a quarter, so that grid is not held to it. Open
 * back vowels are left to the fine-grid check of the reference head: their
 * weak, damped F1 makes a per-head pass/fail unreliable.
 */
const HEAD_VOWELS = ['ə', 'i'];
const HEAD_TOLERANCE = { waveguide: 0.15, fdtd3d: 0.15 };
/** Vowel table of each solver, as in synthesis (src/acoustics/voice.js). */
const VOWEL_TABLES = { fdtd3d: VOWEL_CORRECTIONS_3D };

function parseArgs(argv) {
  const args = {
    out: 'ci-artifacts/simulation',
    dx: 0.6,
    maxTier: 'high',
    heads: 24,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    const next = () => argv[++index];
    if (value === '--out') {
      args.out = next();
    } else if (value === '--dx') {
      args.dx = Number(next());
    } else if (value === '--max-tier') {
      args.maxTier = next();
    } else if (value === '--heads') {
      args.heads = Number(next());
    } else if (value === '--verbose') {
      args.verbose = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
  return condition;
}

function timed(fn) {
  const start = performance.now();
  const value = fn();
  return { value, seconds: (performance.now() - start) / 1000 };
}

function peak(samples) {
  let max = 0;
  for (const value of samples) {
    max = Math.max(max, Math.abs(value));
  }
  return max;
}

function vowelShape(symbol, head, sections, solverName) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    head,
    { sections, vowelCorrections: VOWEL_TABLES[solverName] }
  );
}

/** Solver with the vowel shape of a head and its step rate (Hz). */
function vowelSolver(solverName, shape, head, model) {
  if (solverName === 'fdtd3d') {
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(head).areas);
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    // The 3D grid stretches its time step to the length of the shape.
    return { solver, rate: 1 / solver.stepDuration(shape) };
  }
  const solver = new Waveguide({ sections: shape.areas.length });
  solver.setNose(noseShape(head).areas);
  solver.setShape(shape.areas, 0);
  return {
    solver,
    rate: (shape.areas.length * SPEED_OF_SOUND) / shape.length,
  };
}

/**
 * Resonances of a solver for a vowel: the impulse-response peaks nearest to
 * `targets`, by default the first two formants of the tube model with the
 * same areas. The impulse response is independent of the glottal source, so
 * it measures the solver alone (LPC on rendered speech also depends on the
 * source spectrum).
 */
function resonances(
  symbol,
  head,
  { solver: solverName, model, sections },
  targets
) {
  const shape = vowelShape(symbol, head, sections, solverName);
  const { solver, rate } = vowelSolver(solverName, shape, head, model);
  const response = new Float64Array(Math.round(rate * 0.08));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  const peaks = spectralPeaks(response, rate, {
    step: 5,
    floor: PEAK_FLOOR,
  });
  const reference =
    targets ?? tubeFormants(shape.areas, shape.length, { count: 2 });
  const nearest = reference.map((target) =>
    peaks.reduce(
      (best, value) =>
        Math.abs(value - target) < Math.abs(best - target) ? value : best,
      Infinity
    )
  );
  const errors = nearest.map(
    (value, index) => Math.abs(value - reference[index]) / reference[index]
  );
  return { reference, nearest, errors };
}

async function checkLanguages(args) {
  const last = AUDIO_TIERS.findIndex((tier) => tier.name === args.maxTier);
  const tiers = AUDIO_TIERS.slice(0, last + 1);
  const results = [];
  for (const language of Object.values(LANGUAGES)) {
    for (const tier of tiers) {
      const { value: result, seconds } = timed(() =>
        synthesize(language.sample, { tier: tier.name, seed: 1 })
      );
      const level = rms(result.samples);
      const loudest = peak(result.samples);
      const label = `${language.code}/${tier.name}`;
      check(result.samples.every(Number.isFinite), `${label}: finite samples`);
      check(level > 0.01, `${label}: audible (rms ${level.toFixed(4)})`);
      check(loudest <= 1, `${label}: no clipping (peak ${loudest.toFixed(3)})`);
      check(result.lang === language.code, `${label}: detected language`);
      const file = path.join(args.out, `${language.code}-${tier.name}.wav`);
      await writeFile(file, encodeWav(result.samples, result.sampleRate));
      results.push({
        language: language.code,
        tier: tier.name,
        ipa: result.ipa,
        duration: result.duration,
        rms: level,
        peak: loudest,
        realtimeFactor: result.duration / seconds,
        file: path.basename(file),
      });
      console.log(
        `${label}: ${result.duration.toFixed(2)} s audio in ${seconds.toFixed(2)} s, rms ${level.toFixed(3)}`
      );
    }
  }
  return results;
}

/**
 * F1 and F2 (Hz) of a measured vowel in the 3D solver with its vowel table:
 * the first two impulse-response peaks above 150 Hz, as in the fit.
 */
function measuredVowelResonances(name, model) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  const shape = tractShape({ height, backness, rounding }, REFERENCE_HEAD, {
    vowelCorrections: VOWEL_CORRECTIONS_3D,
  });
  const solver = new Fdtd3d({ model });
  solver.setNose(noseShape(REFERENCE_HEAD).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  const rate = 1 / solver.stepDuration(shape);
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { step: 2, prominence: 0.5 })
    .filter((value) => value > 150)
    .slice(0, 2)
    .map(Math.round);
}

function checkResonances(args) {
  const { value: model, seconds: buildSeconds } = timed(() =>
    buildVoxelModel(REFERENCE_HEAD, { dx: args.dx })
  );
  console.log(
    `voxel model dx=${args.dx}: ${model.cells.length} cells in ${buildSeconds.toFixed(2)} s`
  );
  const results = [];
  for (const symbol of RESONANCE_VOWELS) {
    const measured = HILLENBRAND.male[symbol].slice(0, 2);
    const fdtd = measuredVowelResonances(symbol, model);
    const errors = measured.map(
      (target, index) => Math.abs((fdtd[index] ?? 0) - target) / target
    );
    errors.forEach((error, index) =>
      check(
        error < RESONANCE_TOLERANCE,
        `/${symbol}/ dx=${args.dx}: F${index + 1} ${fdtd[index]} Hz vs men ${measured[index]} Hz (tolerance ${RESONANCE_TOLERANCE * 100}%)`
      )
    );
    results.push({ vowel: symbol, measured, fdtd, errors });
    console.log(`/${symbol}/ men ${measured.join(' ')} fdtd ${fdtd.join(' ')}`);
  }
  return { dx: args.dx, cells: model.cells.length, vowels: results };
}

function checkRandomHeads(args) {
  const results = [];
  for (let index = 0; index < args.heads; index++) {
    const seed = `ci-${index}`;
    const head = randomHeadConfig(seed);
    // Every fourth head also runs through the 3D solver.
    const solver = index % 4 === 0 ? 'fdtd3d' : 'waveguide';
    const options = { sampleRate: 24000, sections: 44, solver };
    if (solver === 'fdtd3d') {
      options.model = buildVoxelModel(head, { dx: args.dx });
    }
    const samples = renderPlan(planUtterance('ˈaː', { head }), options);
    const level = rms(samples);
    const label = `head ${seed} (${solver})`;
    check(samples.every(Number.isFinite), `${label}: finite samples`);
    check(level > 0.01, `${label}: audible (rms ${level.toFixed(4)})`);
    const tolerance = HEAD_TOLERANCE[solver];
    const vowels = {};
    const against = solver === 'fdtd3d' ? 'waveguide' : 'tube';
    for (const symbol of HEAD_VOWELS) {
      const waveguide = resonances(symbol, head, {
        solver: 'waveguide',
        sections: options.sections,
      });
      const { reference, nearest, errors } =
        solver === 'fdtd3d'
          ? resonances(symbol, head, options, waveguide.nearest)
          : waveguide;
      errors.forEach((error, formant) =>
        check(
          error < tolerance,
          `${label}: /${symbol}/ F${formant + 1} ${nearest[formant]} Hz vs ${against} ${Math.round(reference[formant])} Hz (tolerance ${tolerance * 100}%)`
        )
      );
      vowels[symbol] = {
        [against]: reference.map(Math.round),
        solver: nearest,
      };
    }
    results.push({ seed, solver, rms: level, vowels });
    if (args.verbose) {
      console.log(
        `${label}: rms ${level.toFixed(3)} ${JSON.stringify(vowels)}`
      );
    }
  }
  return results;
}

function benchmark() {
  return AUDIO_TIERS.map((tier) => ({
    tier: tier.name,
    load: measureAudioTier(tier, { seconds: 0.2 }),
  }));
}

function summary(report) {
  const lines = ['## Simulation checks', ''];
  lines.push('| Tier | Load on runner |', '| --- | --- |');
  for (const { tier, load } of report.benchmark) {
    lines.push(`| ${tier} | ${(load * 100).toFixed(0)}% |`);
  }
  lines.push('', `### 3D FDTD resonances (dx = ${report.resonances.dx} cm)`);
  lines.push('', '| Vowel | Men F1, F2 | FDTD F1, F2 |', '| --- | --- | --- |');
  for (const vowel of report.resonances.vowels) {
    lines.push(
      `| /${vowel.vowel}/ | ${vowel.measured.join(', ')} | ${vowel.fdtd.join(', ')} |`
    );
  }
  lines.push('', '### Sample sentences', '');
  lines.push('| Language | Tier | Duration | Realtime factor |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of report.languages) {
    lines.push(
      `| ${item.language} | ${item.tier} | ${item.duration.toFixed(2)} s | ${item.realtimeFactor.toFixed(2)}x |`
    );
  }
  lines.push(
    '',
    failures.length === 0
      ? 'All simulation checks passed.'
      : `**${failures.length} check(s) failed:**\n\n${failures.map((item) => `- ${item}`).join('\n')}`
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const started = performance.now();
  const report = {
    benchmark: benchmark(),
    languages: await checkLanguages(args),
    resonances: checkResonances(args),
    heads: checkRandomHeads(args),
    failures,
    seconds: 0,
  };
  report.seconds = (performance.now() - started) / 1000;
  await writeFile(
    path.join(args.out, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(report));
  }
  console.log(
    `${failures.length === 0 ? 'passed' : `${failures.length} failure(s)`} in ${report.seconds.toFixed(1)} s`
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
