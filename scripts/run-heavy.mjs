#!/usr/bin/env node

/**
 * Runner for the heavy checks in tests/heavy/ (see tests/heavy/README.md).
 *
 * Usage:
 *   node scripts/run-heavy.mjs [--suite <name>] [--limit <n>] [--out <dir>] [--dir <dir>]
 *
 *   --suite  all (default), quality, recognition, roundtrip, copy,
 *            performance or gpu; selects <dir>/<suite>-*.test.js.
 *   --limit  positive integer: the largest number of items (utterances,
 *            files) each test may process; passed on as HEAVY_LIMIT.
 *   --out    folder for reports, default reports/heavy; passed on as
 *            HEAVY_OUT.
 *   --dir    folder with the test files, default tests/heavy.
 *
 * The files run in one `node --test` process, one file at a time, with
 * HEAVY=1 in the environment; its exit code is the exit code of this
 * script. At the end <out>/summary.md gets one row per test file with its
 * result and wall time, followed by every <out>/*.md the tests wrote, and
 * is appended to $GITHUB_STEP_SUMMARY when that is set.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

export const SUITES = Object.freeze([
  'all',
  'quality',
  'recognition',
  'roundtrip',
  'copy',
  'performance',
  'gpu',
]);

/** One hour per test: the heavy tests render and recognise whole datasets. */
export const TEST_TIMEOUT_MS = 3_600_000;

const USAGE =
  'Usage: node scripts/run-heavy.mjs [--suite <name>] [--limit <n>] [--out <dir>] [--dir <dir>]';

const reporterPath = fileURLToPath(
  new URL('./heavy-reporter.mjs', import.meta.url)
);

class UsageError extends Error {}

/**
 * @param {string[]} argv arguments after the script name
 * @returns {{suite: string, limit: number|null, out: string, dir: string}}
 */
export function parseArgs(argv) {
  const options = {
    suite: 'all',
    limit: null,
    out: 'reports/heavy',
    dir: 'tests/heavy',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const match = arg.match(/^--(suite|limit|out|dir)(?:=(.*))?$/);
    if (!match) {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === '') {
      throw new UsageError(`--${match[1]} needs a value`);
    }
    options[match[1]] = value;
  }
  if (!SUITES.includes(options.suite)) {
    throw new UsageError(
      `Unknown suite: ${options.suite}. Suites: ${SUITES.join(', ')}`
    );
  }
  if (options.limit !== null) {
    if (!/^[0-9]+$/.test(options.limit) || Number(options.limit) < 1) {
      throw new UsageError(
        `--limit must be a positive integer, got ${options.limit}`
      );
    }
    options.limit = Number(options.limit);
  }
  return options;
}

/**
 * Test files of a suite, sorted by name.
 * @param {string} dir
 * @param {string} suite
 * @returns {string[]} file names relative to dir
 */
export function selectTestFiles(dir, suite) {
  if (!existsSync(dir)) {
    return [];
  }
  const prefix = suite === 'all' ? '' : `${suite}-`;
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.test.js') &&
        entry.name.startsWith(prefix)
    )
    .map((entry) => entry.name)
    .sort();
}

function readEvents(eventsPath) {
  if (!existsSync(eventsPath)) {
    return [];
  }
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * Result and wall time of each file from the events of heavy-reporter.mjs.
 * Node.js reports a whole file as a top-level test named after the file;
 * when that event is missing the durations of its top-level tests are
 * summed instead.
 * @param {string[]} files absolute paths
 * @param {object[]} events
 */
export function summarizeFiles(files, events) {
  return files.map((file) => {
    const own = events.filter(
      (event) => event.file && path.resolve(event.file) === file
    );
    const names = new Set([file, path.basename(file)]);
    const whole = own.find(
      (event) =>
        event.type === 'test:complete' &&
        event.nesting === 0 &&
        names.has(event.name)
    );
    const failed =
      own.some((event) => event.type === 'test:fail') ||
      whole?.passed === false;
    const topLevel = own.filter(
      (event) =>
        (event.type === 'test:pass' || event.type === 'test:fail') &&
        event.nesting === 0
    );
    const durationMs =
      whole?.durationMs ??
      (topLevel.length > 0
        ? topLevel.reduce((sum, event) => sum + (event.durationMs ?? 0), 0)
        : null);
    let result = 'no result';
    if (failed) {
      result = 'fail';
    } else if (own.length > 0) {
      result = 'pass';
    }
    return { file: path.basename(file), result, durationMs };
  });
}

/**
 * @param {{suite: string, limit: number|null, rows: object[], reports: {name: string, markdown: string}[], exitCode: number}} summary
 */
export function formatSummary({ suite, limit, rows, reports, exitCode }) {
  const lines = [
    `# Heavy checks: suite ${suite}`,
    '',
    `Limit: ${limit ?? 'none'}. Exit code: ${exitCode}.`,
    '',
    '| Test file | Result | Wall time (s) |',
    '| --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.file} | ${row.result} | ${
          row.durationMs === null ? '-' : (row.durationMs / 1000).toFixed(1)
        } |`
    ),
    '',
  ];
  for (const report of reports) {
    lines.push(report.markdown.trimEnd(), '');
  }
  return lines.join('\n');
}

/**
 * Markdown reports the tests wrote into out during this run.
 * @param {string} out
 * @param {number} sinceMs
 */
function readReports(out, sinceMs) {
  return readdirSync(out)
    .filter((name) => name.endsWith('.md') && name !== 'summary.md')
    .sort()
    .filter((name) => statSync(path.join(out, name)).mtimeMs >= sinceMs)
    .map((name) => ({
      name,
      markdown: readFileSync(path.join(out, name), 'utf8'),
    }));
}

function nodeExecutable() {
  // Under Bun or Deno process.execPath is not Node.js.
  return process.versions.bun || globalThis.Deno ? 'node' : process.execPath;
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) {
      throw error;
    }
    console.error(error.message);
    console.error(USAGE);
    console.error(`Suites: ${SUITES.join(', ')}`);
    return 2;
  }

  const dir = path.resolve(options.dir);
  const out = path.resolve(options.out);
  const names = selectTestFiles(dir, options.suite);
  if (names.length === 0) {
    console.log(`suite ${options.suite}: no test files`);
    return 0;
  }
  mkdirSync(out, { recursive: true });

  const files = names.map((name) => path.join(dir, name));
  const eventsDir = mkdtempSync(path.join(tmpdir(), 'heavy-events-'));
  const eventsPath = path.join(eventsDir, 'events.jsonl');
  const env = { ...process.env, HEAVY: '1', HEAVY_OUT: out };
  // Set when this script itself runs under `node --test`; it would make the
  // inner run report to the outer one and skip the reporters given here.
  delete env.NODE_TEST_CONTEXT;
  delete env.HEAVY_LIMIT;
  if (options.limit !== null) {
    env.HEAVY_LIMIT = String(options.limit);
  }
  // File times have a coarse resolution on some file systems.
  const startedMs = Date.now() - 2000;

  console.log(
    `suite ${options.suite}: ${names.length} test file(s), limit ${
      options.limit ?? 'none'
    }, reports in ${out}`
  );
  const child = spawnSync(
    nodeExecutable(),
    [
      '--test',
      `--test-timeout=${TEST_TIMEOUT_MS}`,
      '--test-concurrency=1',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      `--test-reporter=${pathToFileURL(reporterPath).href}`,
      `--test-reporter-destination=${eventsPath}`,
      ...files,
    ],
    { env, stdio: 'inherit' }
  );
  if (child.error) {
    console.error(`Could not start Node.js: ${child.error.message}`);
  }
  const exitCode = child.status ?? 1;

  const rows = summarizeFiles(files, readEvents(eventsPath));
  rmSync(eventsDir, { recursive: true, force: true });
  const summary = formatSummary({
    suite: options.suite,
    limit: options.limit,
    rows,
    reports: readReports(out, startedMs),
    exitCode,
  });
  const summaryPath = path.join(out, 'summary.md');
  writeFileSync(summaryPath, summary);
  console.log(`Summary written to ${summaryPath}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  return exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
