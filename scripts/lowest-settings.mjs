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
 * A selected lowest-settings row replaces that row's runs and records its
 * measurement separately from the original full run.
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
  return Number((process.resourceUsage().maxRSS / 1024).toFixed(1));
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
  const { metrics, seconds, audioSeconds, cases } = await ROWS[row]({
    engine: loaded,
    limit,
    // The 16 kHz quality reference is measured once, in the js run.
    baseline: engine === 'js',
  });
  return {
    row,
    engine,
    metrics,
    ...(cases && { cases }),
    seconds: Number(seconds.toFixed(3)),
    audioSeconds: Number(audioSeconds.toFixed(3)),
    peakRssMb: peakRssMb(),
  };
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function completeRow(previous, current) {
  return (
    previous &&
    Object.keys(previous).every((engine) => {
      const result = current?.[engine];
      return result?.metrics && !result.error && !result.unavailable;
    })
  );
}

function combineRow(committed, measured) {
  const {
    row,
    runs,
    limits,
    measured: date,
    commit,
    command,
    cpu,
    node,
    pinned,
    core,
    limit,
  } = measured;
  if (
    limit !== null ||
    !pinned ||
    !limits?.[row] ||
    !completeRow(committed?.runs?.[row], runs?.[row])
  ) {
    throw new Error(`Expected a complete, pinned measurement for row "${row}"`);
  }
  return {
    ...committed,
    runs: { ...committed.runs, [row]: runs[row] },
    limits: { ...committed.limits, [row]: limits[row] },
    rowMeasurements: {
      ...committed.rowMeasurements,
      [row]: { measured: date, commit, command, cpu, node, pinned, core },
    },
  };
}

function judgeMeasurement(measured, app) {
  if (app && measured.limits?.app) {
    measured.runs = { ...measured.runs, app: { js: app } };
  }
  // Rejudge downloaded runs against the limits used on the runner.
  if (Object.keys(measured.runs ?? {}).length && measured.limits) {
    measured.cells = judge(measured.runs, measured.limits);
  }
}

/**
 * Publish a measured matrix into the committed report and README. Returns
 * {written, regressions}; written is false when a regression was refused.
 */
export function publish(dir, { root = ROOT, allowRegression } = {}) {
  let measured = readJson(path.join(dir, 'lowest-settings.json'));
  if (!measured) {
    throw new Error(`${dir}/lowest-settings.json is missing`);
  }
  const reportJson = path.join(root, REPORT_PATH.replace(/\.md$/u, '.json'));
  const committed = readJson(reportJson);
  const selected = measured.row;
  if (selected) {
    measured = combineRow(committed, measured);
  }
  // The app row may be measured again on its own
  // (node scripts/check-app-lowest.mjs --skip-build --out <dir>).
  const app = !selected && readJson(path.join(dir, 'lowest-app.json'))?.result;
  judgeMeasurement(measured, app);
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
