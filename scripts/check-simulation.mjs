#!/usr/bin/env node
/**
 * Heavy simulation checks that run in CI only (the unit tests use coarse
 * grids so they stay fast on development machines).
 *
 *   1. Every language sample sentence is synthesized with every audio tier
 *      up to `--max-tier` and saved as WAV for listening.
 *   2. The 3D FDTD solver on the fine `--dx` grid reproduces the resonances
 *      of the tube model for the cardinal vowels.
 *   3. Random heads stay stable, and both solvers keep the tube-model
 *      resonances of /ə/ and /i/ for each head.
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
  DEFAULT_HEAD,
  Fdtd3d,
  LANGUAGES,
  buildVoxelModel,
  encodeWav,
  getPhoneme,
  measureAudioTier,
  noseShape,
  planUtterance,
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

const VOWELS = ['i', 'e', 'a', 'ɑ', 'o', 'u', 'ə'];
/** Allowed relative error of FDTD resonances against the tube model. */
const RESONANCE_TOLERANCE = 0.15;
/**
 * Known deviations of the 3D shape from the straight 1D tube. For /a/ the
 * 3D solver merges F1 (948 Hz in the tube) and F2 (1430 Hz) into one strong
 * peak near 1120-1155 Hz on 0.4, 0.6 and 1 cm grids alike, so it is a
 * geometry effect and not discretisation error (see
 * experiments/fdtd-open-vowel-peaks.mjs and the issue-1 case study).
 */
const KNOWN_TOLERANCE = { a: 0.25 };
/** Spectral peaks weaker than this (dB below the strongest) are ignored. */
const PEAK_FLOOR = 12;
/**
 * Vowels and tolerances of the random-head check. Over 100 random heads the
 * /ə/ and /i/ resonances stay within 11% of the tube model in the waveguide
 * and within 22% in the 1 cm FDTD grid. Open back vowels are left to the
 * fine-grid check of the default head: their weak, damped F1 and the 3D
 * F1/F2 merge make a per-head pass/fail unreliable (see
 * experiments/random-head-resonances.mjs).
 */
const HEAD_VOWELS = ['ə', 'i'];
const HEAD_TOLERANCE = { waveguide: 0.15, fdtd3d: 0.25 };

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

function vowelShape(symbol, head, sections) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    head,
    sections ? { sections } : undefined
  );
}

/** Solver with the vowel shape of a head and its step rate (Hz). */
function vowelSolver(solverName, shape, head, model) {
  if (solverName === 'fdtd3d') {
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(head).areas);
    solver.setShape(shape.areas, 0);
    return { solver, rate: 1 / solver.stepDuration() };
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
 * the first two formants of the tube model with the same areas. The impulse
 * response is independent of the glottal source, so it measures the solver
 * alone (LPC on rendered speech also depends on the source spectrum).
 */
function resonances(symbol, head, { solver: solverName, model, sections }) {
  const shape = vowelShape(symbol, head, sections);
  const { solver, rate } = vowelSolver(solverName, shape, head, model);
  const response = new Float64Array(Math.round(rate * 0.08));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  const peaks = spectralPeaks(response, rate, {
    step: 5,
    floor: PEAK_FLOOR,
  });
  const tube = tubeFormants(shape.areas, shape.length, { count: 2 });
  const nearest = tube.map((target) =>
    peaks.reduce(
      (best, value) =>
        Math.abs(value - target) < Math.abs(best - target) ? value : best,
      Infinity
    )
  );
  const errors = nearest.map(
    (value, index) => Math.abs(value - tube[index]) / tube[index]
  );
  return { tube, nearest, errors };
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

function checkResonances(args) {
  const { value: model, seconds: buildSeconds } = timed(() =>
    buildVoxelModel(DEFAULT_HEAD, { dx: args.dx })
  );
  console.log(
    `voxel model dx=${args.dx}: ${model.cells.length} cells in ${buildSeconds.toFixed(2)} s`
  );
  const results = [];
  for (const symbol of VOWELS) {
    const { tube, nearest, errors } = resonances(symbol, DEFAULT_HEAD, {
      solver: 'fdtd3d',
      model,
    });
    const tolerance = KNOWN_TOLERANCE[symbol] ?? RESONANCE_TOLERANCE;
    for (const index of [0, 1]) {
      check(
        errors[index] < tolerance,
        `/${symbol}/ dx=${args.dx}: F${index + 1} ${nearest[index]} Hz vs tube ${Math.round(tube[index])} Hz (tolerance ${tolerance * 100}%)`
      );
    }
    results.push({
      vowel: symbol,
      tube: tube.map(Math.round),
      fdtd: nearest,
      errors,
      tolerance,
    });
    console.log(
      `/${symbol}/ tube ${tube.map(Math.round).join(' ')} fdtd ${nearest.join(' ')}`
    );
  }
  return { dx: args.dx, cells: model.cells.length, vowels: results };
}

function checkRandomHeads(args) {
  const results = [];
  for (let index = 0; index < args.heads; index++) {
    const seed = `ci-${index}`;
    const head = randomHeadConfig(seed);
    // Every fourth head also runs through the 3D solver (coarse grid).
    const solver = index % 4 === 0 ? 'fdtd3d' : 'waveguide';
    const options = { sampleRate: 24000, sections: 44, solver };
    if (solver === 'fdtd3d') {
      options.model = buildVoxelModel(head, { dx: 1 });
    }
    const samples = renderPlan(planUtterance('ˈaː', { head }), options);
    const level = rms(samples);
    const label = `head ${seed} (${solver})`;
    check(samples.every(Number.isFinite), `${label}: finite samples`);
    check(level > 0.01, `${label}: audible (rms ${level.toFixed(4)})`);
    const tolerance = HEAD_TOLERANCE[solver];
    const vowels = {};
    for (const symbol of HEAD_VOWELS) {
      const { tube, nearest, errors } = resonances(symbol, head, options);
      errors.forEach((error, formant) =>
        check(
          error < tolerance,
          `${label}: /${symbol}/ F${formant + 1} ${nearest[formant]} Hz vs tube ${Math.round(tube[formant])} Hz (tolerance ${tolerance * 100}%)`
        )
      );
      vowels[symbol] = { tube: tube.map(Math.round), solver: nearest };
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
  lines.push(
    '',
    '| Vowel | Tube F1, F2 | FDTD F1, F2 |',
    '| --- | --- | --- |'
  );
  for (const vowel of report.resonances.vowels) {
    lines.push(
      `| /${vowel.vowel}/ | ${vowel.tube.join(', ')} | ${vowel.fdtd.join(', ')} |`
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
