#!/usr/bin/env node

/**
 * Performance tracking (issue 31): the real-time factor (RTF, seconds of
 * work per second of audio) of every audio tier on both engines, compared
 * with a committed baseline and kept as a trend.
 *
 * Usage:
 *   node scripts/performance.mjs compare <report.json> [--baseline <file>] [--tolerance <n>] [--partial]
 *   node scripts/performance.mjs baseline <report.json> [--dir <folder>]
 *   node scripts/performance.mjs trend <report.json> [--dir <folder>]
 *
 *   compare   prints the table of comparePerformance against the baseline
 *             (default <folder>/performance-baseline.json) and exits with 1
 *             when a speed rule fails.
 *   baseline  writes the report to <folder>/performance-baseline.json.
 *   trend     puts the report into <folder>/performance-history.json (one
 *             run per commit, sorted by date), writes <folder>/performance.md
 *             again and formats the files with the local prettier.
 *   --dir     folder of the three files, default docs/reports.
 *
 * A missing or unreadable file, or another `schema`, prints a message and
 * exits with 2. The report (schema 1) is written by
 * tests/heavy/performance-tiers.test.js to reports/heavy/performance-tiers.json:
 *   {schema: 1, date, commit, version, machine: {cpu, cores, platform, arch,
 *    runtime}, text, calibration, rows}
 * with rows {task: 'synthesis', engine, tier, solver, sampleRate, duration,
 * runs, seconds, median, rtf}. See "Heavy checks" in docs/CONTRIBUTING.md.
 *
 * No dependencies: the measuring functions take the synthesizer and the
 * clock as arguments.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';

import { AUDIO_TIERS } from '../src/perf/lod.js';

/** Layout of the report, the baseline and the history. */
export const SCHEMA = 1;

/**
 * Largest ratio of a row's RTF to its baseline RTF (times the machine
 * scale) that passes, and its inverse the smallest that is not `faster`.
 */
export const DEFAULT_TOLERANCE = 1.5;

/** Rust may be this much slower than JavaScript before it fails. */
export const ENGINE_SLACK = 1.1;

/** Largest RTF of a waveguide tier: twice faster than real time. */
export const REALTIME = 0.5;

/** Timed runs per tier, by solver: the 3D tiers take seconds per run. */
export const RUNS = Object.freeze({ waveguide: 5, fdtd3d: 2 });

/** The untimed warm-up text of every engine and tier. */
export const WARM_UP_TEXT = 'Hi.';

/** A measured cost this far from `tier.cost` gets a note under the table. */
export const COST_NOTE = 1.5;

/** The three committed files, in the folder of --dir. */
export const FILES = Object.freeze({
  baseline: 'performance-baseline.json',
  history: 'performance-history.json',
  markdown: 'performance.md',
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_DIR = path.join(ROOT, 'docs', 'reports');
const PRETTIER = path.join(ROOT, 'node_modules', 'prettier', 'bin');

const USAGE =
  'Usage: node scripts/performance.mjs <compare|baseline|trend> <report.json> [--baseline <file>] [--tolerance <n>] [--partial] [--dir <folder>]';

/** Keeps the result of the calibration loop alive (no dead code). */
export let sink = 0;

/**
 * How fast this machine is: the best time in seconds of a 1D wave equation,
 * 2000 steps over 4096 cells of Float32Array.
 * @param {number} [runs]
 * @param {() => number} [now] clock in milliseconds
 * @returns {number}
 */
export function calibrate(runs = 5, now = () => performance.now()) {
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    let p = new Float32Array(4096);
    let q = new Float32Array(4096);
    p[2048] = 1;
    const start = now();
    for (let step = 0; step < 2000; step++) {
      for (let i = 1; i <= 4094; i++) {
        q[i] = p[i - 1] + p[i + 1] - q[i];
      }
      [p, q] = [q, p];
    }
    best = Math.min(best, (now() - start) / 1000);
    sink += p[2048];
  }
  return best;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** `'js'`, `'rust'` or `{name, engine, threads}` as one shape. */
function engineEntry(entry) {
  return typeof entry === 'string'
    ? { name: entry, engine: entry, threads: 1 }
    : { threads: 1, ...entry, engine: entry.engine ?? entry.name };
}

/**
 * Time `synthesize` on every tier and engine: one untimed warm-up with
 * 'Hi.', then RUNS[solver] timed renders of `text`.
 * @param {{tiers: {name: string, solver: string}[], engines: (string|{name: string, engine?: unknown, threads?: number|'auto'})[], text: string, seed?: number, synthesize: Function, now?: () => number, inspect?: (result: object, row: object) => void}} options
 *   `engines` are names, or the label of the row with the `engine` and
 *   `threads` options to render with (`rust-mt`); `now` is a clock in
 *   milliseconds; `inspect` gets the last result of every row.
 * @returns {object[]} rows {task, engine, tier, solver, sampleRate, duration, runs, seconds, median, rtf}
 */
export function measureRows({
  tiers,
  engines,
  text,
  seed = 1,
  synthesize,
  now = () => performance.now(),
  inspect,
}) {
  const rows = [];
  for (const tier of tiers) {
    for (const entry of engines.map(engineEntry)) {
      const options = {
        tier: tier.name,
        seed,
        engine: entry.engine,
        threads: entry.threads,
      };
      synthesize(WARM_UP_TEXT, options);
      const runs = RUNS[tier.solver] ?? RUNS.fdtd3d;
      const times = [];
      let result;
      for (let run = 0; run < runs; run++) {
        const start = now();
        result = synthesize(text, options);
        times.push((now() - start) / 1000);
      }
      const seconds = Math.min(...times);
      const row = {
        task: 'synthesis',
        engine: entry.name,
        tier: tier.name,
        solver: tier.solver,
        sampleRate: result.sampleRate,
        duration: result.duration,
        runs,
        seconds,
        median: median(times),
        rtf: seconds / result.duration,
      };
      inspect?.(result, row);
      rows.push(row);
    }
  }
  return rows;
}

/** `task/engine/tier`: how rows are matched. */
export function rowKey(row) {
  return `${row.task}/${row.engine}/${row.tier}`;
}

function rowStatus(rtf, expected, tolerance) {
  if (rtf > expected * tolerance) {
    return 'slower';
  }
  return rtf < expected / tolerance ? 'faster' : 'ok';
}

/** Failures of the rules that need no baseline. */
function ruleFailures(rows, engineSlack, realtime) {
  const failures = [];
  for (const row of rows) {
    if (row.engine !== 'rust') {
      continue;
    }
    const js = rows.find(
      (other) =>
        other.engine === 'js' &&
        other.task === row.task &&
        other.tier === row.tier
    );
    if (js && row.rtf > js.rtf * engineSlack) {
      failures.push(`rust is slower than js at ${row.tier}`);
    }
  }
  for (const row of rows) {
    if (row.solver === 'waveguide' && row.rtf > realtime) {
      failures.push(`${row.tier} is not real time on ${row.engine}`);
    }
  }
  return failures;
}

/**
 * Compare a report with a baseline. `scale` = report.calibration /
 * baseline.calibration says how much slower this machine is; a row is
 * `slower` above baseline RTF × scale × tolerance, `faster` below
 * baseline RTF × scale / tolerance, `new` without a baseline row, and a
 * baseline row without a report row is `missing` (ignored when `partial`).
 * @param {{calibration: number, rows: object[]}} report
 * @param {{calibration: number, rows: object[]}} baseline
 * @param {{tolerance?: number, engineSlack?: number, realtime?: number, partial?: boolean}} [options]
 * @returns {{ok: boolean, scale: number, rows: object[], failures: string[]}}
 *   rows: the report rows with `baseline` (its RTF or null), `expected`
 *   (baseline × scale), `limit`, `ratio` (RTF / expected) and `status`,
 *   then the missing rows with `rtf: null`
 */
export function comparePerformance(report, baseline, options = {}) {
  const {
    tolerance = DEFAULT_TOLERANCE,
    engineSlack = ENGINE_SLACK,
    realtime = REALTIME,
    partial = false,
  } = options;
  const scale = report.calibration / baseline.calibration;
  const base = new Map(baseline.rows.map((row) => [rowKey(row), row]));
  const seen = new Set();
  const rows = [];
  const failures = [];
  for (const row of report.rows) {
    const key = rowKey(row);
    seen.add(key);
    const old = base.get(key);
    if (!old) {
      rows.push({
        ...row,
        baseline: null,
        expected: null,
        limit: null,
        ratio: null,
        status: 'new',
      });
      continue;
    }
    const expected = old.rtf * scale;
    const limit = expected * tolerance;
    const status = rowStatus(row.rtf, expected, tolerance);
    rows.push({
      ...row,
      baseline: old.rtf,
      expected,
      limit,
      ratio: row.rtf / expected,
      status,
    });
    if (status === 'slower') {
      failures.push(
        `${key} is slower: RTF ${digits(row.rtf, 3)} > ${digits(limit, 3)} (baseline ${digits(old.rtf, 3)} x scale ${digits(scale, 3)} x tolerance ${tolerance})`
      );
    }
  }
  for (const [key, old] of base) {
    if (partial || seen.has(key)) {
      continue;
    }
    const expected = old.rtf * scale;
    rows.push({
      ...old,
      rtf: null,
      baseline: old.rtf,
      expected,
      limit: expected * tolerance,
      ratio: null,
      status: 'missing',
    });
    failures.push(`${key} is missing`);
  }
  failures.push(...ruleFailures(report.rows, engineSlack, realtime));
  return { ok: failures.length === 0, scale, rows, failures };
}

/** `value` with `count` significant digits, without trailing zeros. */
export function digits(value, count = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return String(Number(value.toPrecision(count)));
}

function cell(text) {
  return String(text).replaceAll('|', '\\|');
}

function tierNames(tiers) {
  return tiers.map((tier) => (typeof tier === 'string' ? tier : tier.name));
}

/** The RTF of `engine` at `tier` in a run, or null. */
function rtfOf(run, engine, tier) {
  const row = run.rows.find(
    (item) =>
      item.task === 'synthesis' && item.engine === engine && item.tier === tier
  );
  return row ? row.rtf : null;
}

/**
 * docs/reports/performance.md: one row per run of the history.
 * @param {{runs: object[]}} history
 * @param {(string|{name: string})[]} tiers columns, in this order
 * @returns {string}
 */
export function trendMarkdown(history, tiers) {
  const names = tierNames(tiers);
  const lines = [
    '# Performance',
    '',
    '<!-- Generated by `node scripts/performance.mjs trend <report.json>`; do not edit by hand. -->',
    '',
    'The real-time factor (RTF) of a tier is the time its fastest render of the sentence takes divided by the duration of the audio, so below 1 is faster than real time. ' +
      'Every render runs on one core (`threads: 1`). ' +
      'Each cell is `JavaScript / Rust` with two significant digits, and `-` marks a row that was not measured.',
    '',
    `| Date | Commit | Version | CPU | Cores | Calibration (ms) | ${names.join(' | ')} |`,
    `| --- | --- | --- | --- | --- | --- |${' --- |'.repeat(names.length)}`,
  ];
  for (const run of history.runs) {
    const cells = names.map(
      (tier) =>
        `${digits(rtfOf(run, 'js', tier))} / ${digits(rtfOf(run, 'rust', tier))}`
    );
    lines.push(
      `| ${run.date.slice(0, 16).replace('T', ' ')} | ${String(run.commit).slice(0, 7)} | ${cell(run.version)} | ${cell(run.machine?.cpu ?? '-')} | ${run.machine?.cores ?? '-'} | ${(run.calibration * 1000).toFixed(1)} | ${cells.join(' | ')} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** The line that describes the machine of a report. */
export function machineLine(report) {
  const { machine } = report;
  return `Machine: ${machine.cpu}, ${machine.cores} cores, ${machine.platform} ${machine.arch}, ${machine.runtime}; calibration ${(report.calibration * 1000).toFixed(1)} ms; commit ${String(report.commit).slice(0, 7)}, version ${report.version}.`;
}

/** Measured cost of the js rows: RTF / RTF of `minimal`, by tier. */
function measuredCosts(rows) {
  const minimal = rows.find(
    (row) => row.engine === 'js' && row.tier === 'minimal' && row.rtf !== null
  );
  const costs = new Map();
  if (minimal) {
    for (const row of rows) {
      if (row.engine === 'js' && row.rtf !== null) {
        costs.set(row.tier, row.rtf / minimal.rtf);
      }
    }
  }
  return costs;
}

/**
 * The table of a comparison: tier, engine, RTF, baseline RTF × scale,
 * ratio, status, and for js rows the measured cost next to `tier.cost`;
 * then a note for every cost off by more than COST_NOTE and the failures.
 * @param {ReturnType<typeof comparePerformance>} comparison
 * @param {readonly {name: string, cost: number}[]} [tiers]
 * @returns {string}
 */
export function comparisonMarkdown(comparison, tiers = AUDIO_TIERS) {
  const costs = measuredCosts(comparison.rows);
  const costOf = (name) => tiers.find((tier) => tier.name === name)?.cost;
  const lines = [
    `Scale (calibration / baseline calibration): ${digits(comparison.scale, 3)}.`,
    '',
    '| Tier | Engine | RTF | Baseline RTF × scale | Ratio | Status | Measured cost | Tier cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const notes = [];
  for (const row of comparison.rows) {
    const measured = row.engine === 'js' ? costs.get(row.tier) : undefined;
    const cost = costOf(row.tier);
    lines.push(
      `| ${row.tier} | ${row.engine} | ${digits(row.rtf, 3)} | ${digits(row.expected, 3)} | ${digits(row.ratio, 3)} | ${row.status} | ${digits(measured, 3)} | ${measured === undefined ? '-' : digits(cost, 3)} |`
    );
    if (
      measured !== undefined &&
      cost !== undefined &&
      Math.max(measured / cost, cost / measured) > COST_NOTE
    ) {
      notes.push(`cost of ${row.tier} is off by more than ${COST_NOTE}x`);
    }
  }
  lines.push('');
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
  if (notes.length > 0) {
    lines.push('');
  }
  lines.push(
    comparison.ok
      ? 'Every speed rule holds.'
      : `Failures:\n\n${comparison.failures.map((failure) => `- ${failure}`).join('\n')}`
  );
  lines.push('');
  return lines.join('\n');
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** The version of package.json. */
export function packageVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    .version;
}

/** The machine of the report: CPU model, cores, platform and runtime. */
export function machineInfo() {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model?.trim() || 'unknown',
    cores:
      typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : cpus.length,
    platform: process.platform,
    arch: process.arch,
    runtime: `node ${process.versions.node}`,
  };
}

/**
 * A report of schema 1 for measured rows.
 * @param {{text: string, calibration: number, rows: object[], date?: Date}} options
 */
export function createReport({ text, calibration, rows, date = new Date() }) {
  return {
    schema: SCHEMA,
    date: date.toISOString(),
    commit: process.env.GITHUB_SHA || gitCommit(),
    version: packageVersion(),
    machine: machineInfo(),
    text,
    calibration,
    rows,
  };
}

/** A file that cannot be used: exit code 2. */
export class FileError extends Error {}

function readJson(file, what) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new FileError(`cannot read the ${what} ${file}: ${error.message}`);
  }
  if (data?.schema !== SCHEMA) {
    throw new FileError(
      `the ${what} ${file} has schema ${data?.schema}, expected ${SCHEMA}`
    );
  }
  return data;
}

/** A report or baseline of schema 1, or a FileError. */
export function readReport(file, what = 'report') {
  const report = readJson(file, what);
  if (!Array.isArray(report.rows) || !(report.calibration > 0)) {
    throw new FileError(
      `the ${what} ${file} has no rows or no positive calibration`
    );
  }
  return report;
}

/** The history, empty when the file does not exist yet. */
export function readHistory(file) {
  if (!existsSync(file)) {
    return { schema: SCHEMA, runs: [] };
  }
  const history = readJson(file, 'history');
  if (!Array.isArray(history.runs)) {
    throw new FileError(`the history ${file} has no runs`);
  }
  return history;
}

/**
 * Add a run to a history: a run of the same commit is replaced, and the
 * runs are sorted by date.
 */
export function addRun(history, report) {
  const runs = history.runs.filter((run) => run.commit !== report.commit);
  runs.push(report);
  runs.sort((a, b) => a.date.localeCompare(b.date));
  return { schema: SCHEMA, runs };
}

/** Tiers of AUDIO_TIERS that a run of the history measured, in order. */
export function historyTiers(history) {
  const measured = new Set(
    history.runs.flatMap((run) => run.rows.map((row) => row.tier))
  );
  const known = AUDIO_TIERS.map((tier) => tier.name);
  return [
    ...known.filter((name) => measured.has(name)),
    ...[...measured].filter((name) => !known.includes(name)).sort(),
  ];
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** `prettier --write` of the repository's own prettier, run by Node.js. */
function format(files, log) {
  const cli = ['prettier.cjs', 'prettier.js']
    .map((name) => path.join(PRETTIER, name))
    .find((file) => existsSync(file));
  if (!cli) {
    log(`prettier is not installed (npm install); not formatted`);
    return;
  }
  const result = spawnSync('node', [cli, '--write', ...files], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    log(`prettier failed: ${result.stderr || result.error?.message}`);
  }
}

class UsageError extends Error {}

/** The options of the command line. */
export function parseArgs(argv) {
  const options = {
    command: null,
    report: null,
    baseline: null,
    tolerance: DEFAULT_TOLERANCE,
    partial: false,
    dir: DEFAULT_DIR,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const match = arg.match(/^--(baseline|tolerance|dir)(?:=(.*))?$/);
    if (arg === '--partial') {
      options.partial = true;
    } else if (match) {
      const value = match[2] ?? argv[++index];
      if (value === undefined || value === '') {
        throw new UsageError(`--${match[1]} needs a value`);
      }
      options[match[1]] = value;
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  [options.command, options.report] = positional;
  if (
    !['compare', 'baseline', 'trend'].includes(options.command) ||
    !options.report ||
    positional.length > 2
  ) {
    throw new UsageError(USAGE);
  }
  options.tolerance = Number(options.tolerance);
  if (!(options.tolerance >= 1)) {
    throw new UsageError('--tolerance must be a number of at least 1');
  }
  return options;
}

function compareCommand(options, report, log) {
  const file = options.baseline ?? path.join(options.dir, FILES.baseline);
  const baseline = readReport(file, 'baseline');
  const comparison = comparePerformance(report, baseline, {
    tolerance: options.tolerance,
    partial: options.partial,
  });
  log(machineLine(report));
  log('');
  log(comparisonMarkdown(comparison));
  return comparison.ok ? 0 : 1;
}

function trendCommand(options, report, log) {
  const historyFile = path.join(options.dir, FILES.history);
  const markdownFile = path.join(options.dir, FILES.markdown);
  const history = addRun(readHistory(historyFile), report);
  writeJson(historyFile, history);
  mkdirSync(options.dir, { recursive: true });
  writeFileSync(markdownFile, trendMarkdown(history, historyTiers(history)));
  const files = [
    path.join(options.dir, FILES.baseline),
    historyFile,
    markdownFile,
  ].filter((file) => existsSync(file));
  format(files, log);
  log(`${historyFile}: ${history.runs.length} runs; wrote ${markdownFile}`);
  return 0;
}

/**
 * The command line; returns the exit code.
 * @param {string[]} argv
 * @param {{log?: (line: string) => void, error?: (line: string) => void}} [io]
 */
export function main(argv, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const error = io.error ?? ((line) => console.error(line));
  try {
    const options = parseArgs(argv);
    const report = readReport(options.report);
    if (options.command === 'compare') {
      return compareCommand(options, report, log);
    }
    if (options.command === 'baseline') {
      const file = path.join(options.dir, FILES.baseline);
      writeJson(file, report);
      format([file], log);
      log(`wrote ${file}`);
      return 0;
    }
    return trendCommand(options, report, log);
  } catch (caught) {
    if (caught instanceof UsageError || caught instanceof FileError) {
      error(caught.message);
      return 2;
    }
    throw caught;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
