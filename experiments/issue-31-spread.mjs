/**
 * Issue 31: the spread of five performance-tiers reports of the same commit.
 *
 *   node experiments/issue-31-spread.mjs run1.json run2.json ...
 *
 * Every row's RTF is divided by the calibration of its report, so the
 * spread (largest / smallest per row) is the noise that the scale of
 * comparePerformance does not remove. The worst spread above 1.25 sets the
 * default tolerance to spread x 1.2, rounded to one decimal. The median run
 * is the one whose geometric mean of normalised RTFs is the median.
 */

import { readReport, rowKey } from '../scripts/performance.mjs';

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('usage: node experiments/issue-31-spread.mjs <report.json>...');
  process.exit(2);
}
const reports = files.map((file) => readReport(file));

const byRow = new Map();
for (const report of reports) {
  for (const row of report.rows) {
    const values = byRow.get(rowKey(row)) ?? [];
    values.push(row.rtf / report.calibration);
    byRow.set(rowKey(row), values);
  }
}

let worst = { key: null, spread: 1 };
console.log('| Row | Runs | Spread (max / min of RTF / calibration) |');
console.log('| --- | --- | --- |');
for (const [key, values] of byRow) {
  const spread = Math.max(...values) / Math.min(...values);
  console.log(`| ${key} | ${values.length} | ${spread.toFixed(3)} |`);
  if (spread > worst.spread) {
    worst = { key, spread };
  }
}

const calibrations = reports.map((report) => report.calibration * 1000);
console.log(
  `\nCalibrations (ms): ${calibrations.map((ms) => ms.toFixed(2)).join(', ')}; spread ${(Math.max(...calibrations) / Math.min(...calibrations)).toFixed(3)}`
);
console.log(`Worst spread: ${worst.spread.toFixed(3)} at ${worst.key}`);
const tolerance =
  worst.spread > 1.25 ? Math.round(worst.spread * 1.2 * 10) / 10 : 1.5;
console.log(`Default tolerance: ${tolerance}`);

const scores = reports.map((report, index) => {
  const logs = report.rows.map((row) => Math.log(row.rtf / report.calibration));
  return { file: files[index], score: logs.reduce((a, b) => a + b, 0) };
});
scores.sort((a, b) => a.score - b.score);
console.log(`Median run: ${scores[Math.floor(scores.length / 2)].file}`);
