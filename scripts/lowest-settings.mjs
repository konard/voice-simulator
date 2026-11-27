#!/usr/bin/env node
/**
 * Lowest-settings certification (issue 81): one row of the matrix on 8 kHz
 * audio with one engine, or publication of a measured matrix. Unlicense.
 *
 *   node scripts/lowest-settings.mjs --row synthesis --engine js [--limit 1] [--out dir]
 *   node scripts/lowest-settings.mjs --publish reports/heavy [--allow-regression "reason"]
 *
 * A row prints { row, engine, metrics, seconds, audioSeconds, peakRssMb }:
 * seconds is the CPU time (user plus system) of the operation under test,
 * audioSeconds the audio it covered and peakRssMb the peak resident memory of
 * the process. A missing engine prints { row, engine, unavailable }.
 * tests/heavy/lowest-settings.test.js runs every row and engine pinned to one
 * core under a 192 MB heap cap.
 *
 * --publish reads <dir>/lowest-settings.json, writes
 * docs/reports/lowest-settings.md and .json and the README table. It refuses
 * (exit 1, files unchanged) when a cell certified in the committed report is
 * no longer certified, unless --allow-regression gives the reason. A
 * <dir>/lowest-app.json measured again on its own replaces the app row.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  formatReport,
  judge,
  linkIssues,
  regressions,
  replaceReadmeTable,
  REPORT_PATH,
} from './lowest-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ISSUES_PATH = 'tests/heavy/lowest-issues.json';

export const USAGE = `Usage:
  node scripts/lowest-settings.mjs --row <name> --engine <js|rust> [--limit <n>] [--out <dir>]
  node scripts/lowest-settings.mjs --publish <dir> [--allow-regression "<reason>"] [--root <dir>]

Rows: synthesis, recognition, streaming, voice-fit, session, copy, modes.`;

/** Peak resident memory of this process in MB. */
export function peakRssMb() {
  return process.resourceUsage().maxRSS / 1024;
}

export async function runRow({ row, engine, limit = Infinity }) {
  const { ROWS, loadEngine } = await import('./lowest-rows.mjs');
  if (!ROWS[row]) {
    throw new RangeError(`Unknown row "${row}"`);
  }
  const loaded = await loadEngine(engine);
  if (loaded.unavailable) {
    return { row, engine, unavailable: loaded.unavailable };
  }
  const { metrics, seconds, audioSeconds } = await ROWS[row]({
    engine: loaded,
    limit,
    // The 16 kHz quality reference is measured once, in the js run.
    baseline: engine === 'js',
  });
  return {
    row,
    engine,
    metrics,
    seconds: Number(seconds.toFixed(3)),
    audioSeconds: Number(audioSeconds.toFixed(3)),
    peakRssMb: peakRssMb(),
  };
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * Publish a measured matrix into the committed report and README. Returns
 * {written, regressions}; written is false when a regression was refused.
 */
export function publish(dir, { root = ROOT, allowRegression } = {}) {
  const measured = readJson(path.join(dir, 'lowest-settings.json'));
  if (!measured) {
    throw new Error(`${dir}/lowest-settings.json is missing`);
  }
  // The app row may be measured again on its own
  // (node scripts/check-app-lowest.mjs --skip-build --out <dir>).
  const app = readJson(path.join(dir, 'lowest-app.json'))?.result;
  if (app && measured.limits?.app) {
    measured.runs = { ...measured.runs, app: { js: app } };
  }
  // The cells are judged again from the runs and the limits of the
  // measurement, so a report downloaded from Heavy checks can be published.
  if (Object.keys(measured.runs ?? {}).length && measured.limits) {
    measured.cells = judge(measured.runs, measured.limits, {}, measured);
  }
  const reportJson = path.join(root, REPORT_PATH.replace(/\.md$/u, '.json'));
  const committed = readJson(reportJson);
  const lost = regressions(committed, measured);
  if (lost.length && !allowRegression) {
    return { written: false, regressions: lost };
  }
  const issues = readJson(path.join(root, ISSUES_PATH)) ?? {};
  const data = {
    ...measured,
    cells: linkIssues(JSON.parse(JSON.stringify(measured.cells)), issues),
    regressions: lost.map((cell) => ({ ...cell, reason: allowRegression })),
  };
  const readmePath = path.join(root, 'README.md');
  const readme = replaceReadmeTable(readFileSync(readmePath, 'utf8'), data);
  mkdirSync(path.dirname(reportJson), { recursive: true });
  writeFileSync(path.join(root, REPORT_PATH), formatReport(data));
  writeFileSync(reportJson, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(readmePath, readme);
  return { written: true, regressions: lost };
}

async function main() {
  const { values } = parseArgs({
    options: {
      row: { type: 'string' },
      engine: { type: 'string', default: 'js' },
      limit: { type: 'string' },
      out: { type: 'string' },
      publish: { type: 'string' },
      'allow-regression': { type: 'string' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.publish) {
    const result = publish(values.publish, {
      root: values.root ? path.resolve(values.root) : ROOT,
      allowRegression: values['allow-regression'],
    });
    if (!result.written) {
      console.error(
        `Refusing to publish: certified cells regressed: ${result.regressions
          .map(({ row, column, status }) => `${row}/${column} (${status})`)
          .join(
            ', '
          )}. Fix them, or pass --allow-regression "<reason>" to record why.`
      );
      return 1;
    }
    console.log(
      `Published ${REPORT_PATH} and the README table${result.regressions.length ? ` with ${result.regressions.length} regression(s)` : ''}.`
    );
    return 0;
  }
  if (!values.row || !['js', 'rust'].includes(values.engine)) {
    console.error(USAGE);
    return 2;
  }
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) {
    console.error('--limit must be a positive integer');
    return 2;
  }
  const result = await runRow({
    row: values.row,
    engine: values.engine,
    limit,
  });
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(
      path.join(values.out, `${values.row}-${values.engine}.json`),
      `${JSON.stringify(result, null, 2)}\n`
    );
  }
  console.log(JSON.stringify(result));
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
