/**
 * Issue 81: draft one GitHub issue body per row of the lowest-settings matrix
 * for the cells that are failed or unavailable, from a measured report.
 *
 *   node experiments/issue-81-issue-bodies.mjs reports/heavy/lowest-settings.json /tmp/issues [run URL]
 *
 * Writes <out>/<row>.md and <out>/<row>.title and prints the cells of each.
 * Unlicense.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { METRICS } from '../scripts/lowest-report.mjs';

const [file, out = '/tmp/lowest-issues', runUrl = ''] = process.argv.slice(2);
// The memory cells share one cause and one issue (written by hand).
const data = JSON.parse(readFileSync(file, 'utf8'));
mkdirSync(out, { recursive: true });

const fmt = (value) =>
  typeof value === 'number' ? String(Number(value.toFixed(4))) : String(value);

for (const [row, cells] of Object.entries(data.cells)) {
  const open = Object.entries(cells).filter(
    ([column, cell]) => cell.status !== 'certified' && column !== 'memory'
  );
  if (!open.length) {
    continue;
  }
  const lines = [
    `The lowest-settings matrix of #81 (8000 Hz, one core, \`--max-old-space-size=192\`, \`UV_THREADPOOL_SIZE=1\`) measured the row **${row}** at commit \`${data.commit.slice(0, 7)}\` on ${data.cpu}, Node ${data.node}:`,
    '',
    '| Column | Status | Metric | Value | Limit |',
    '| --- | --- | --- | ---: | ---: |',
  ];
  for (const [column, cell] of open) {
    const metrics = Object.entries(cell.metrics ?? {}).filter(
      ([, metric]) => !metric.pass
    );
    if (!metrics.length) {
      lines.push(
        `| ${column} | ${cell.status} | ${cell.reason ?? '—'} | — | — |`
      );
    }
    for (const [name, metric] of metrics) {
      lines.push(
        `| ${column} | ${cell.status} | ${METRICS[name] ?? name} | ${fmt(metric.value)} | ${fmt(metric.limit)} |`
      );
    }
  }
  const runs = Object.entries(data.runs[row] ?? {}).map(
    ([engine, run]) =>
      `- ${engine}: ${run.unavailable ? `unavailable (${run.unavailable})` : `${fmt(run.seconds)} s CPU for ${fmt(run.audioSeconds)} s of audio, peak RSS ${fmt(run.peakRssMb)} MB${run.capped?.crashed ? `, crashed under the 192 MB heap cap (${run.capped.crashed})` : ''}; ${JSON.stringify(run.metrics ?? {})}`}`
  );
  lines.push(
    '',
    'Runs:',
    '',
    ...runs,
    '',
    'Reproduce one cell:',
    '',
    '```bash',
    `taskset -c 0 node --max-old-space-size=192 scripts/lowest-settings.mjs --row ${row} --engine js`,
    '```',
    '',
    `The whole matrix: \`${data.command}\`${runUrl ? ` in [Heavy checks](${runUrl})` : ''} (report: docs/reports/lowest-settings.md). The limits are in tests/heavy/lowest-thresholds.json and may not be loosened; this issue closes when the cells above are certified.`
  );
  writeFileSync(path.join(out, `${row}.md`), `${lines.join('\n')}\n`);
  writeFileSync(
    path.join(out, `${row}.title`),
    `Lowest settings: ${row} is ${[...new Set(open.map(([, cell]) => cell.status))].join(' and ')} at 8 kHz on one core (${open.map(([column]) => column).join(', ')})`
  );
  console.log(
    row,
    open.map(([column, cell]) => `${column}:${cell.status}`)
  );
}
