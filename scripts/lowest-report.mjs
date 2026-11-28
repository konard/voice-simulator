/**
 * Judging, Markdown and README table of the lowest-settings matrix (issue
 * 81). Every cell is certified, failed or unavailable. Unlicense.
 */

export const COLUMNS = ['quality', 'js-1', 'rust-1', 'memory'];
export const ROW_NAMES = [
  'synthesis',
  'recognition',
  'streaming',
  'voice-fit',
  'session',
  'copy',
  'modes',
  'app',
];
export const README_START = '<!-- lowest-settings:start -->';
export const README_END = '<!-- lowest-settings:end -->';
export const REPORT_PATH = 'docs/reports/lowest-settings.md';

/** Metrics that must reach their limit; every other limit is a maximum. */
const MINIMUMS = new Set([
  'stable',
  'phonemeAgreement',
  'modeShare',
  'textBack',
]);

export const METRICS = {
  wer: 'WER at 8 kHz',
  wer16k: 'WER at 16 kHz',
  werIncrease: 'WER increase over 16 kHz',
  per: 'PER at 8 kHz',
  per16k: 'PER at 16 kHz',
  perIncrease: 'PER increase over 16 kHz',
  rtf: 'real-time factor',
  recognitionRtf: 'recognition real-time factor',
  renderRtf: 'render real-time factor',
  textMismatch: 'stream text differing from batch (WER)',
  firstPartial: 'first partial with words (s)',
  load: 'CPU load',
  vocalTractLengthError: 'vocal tract length error',
  pitchError: 'pitch error',
  cpuRatio: 'CPU time / audio time',
  stable: 'share of voices reaching stable',
  f0RmseSemitones: 'mean f0 RMSE (semitones)',
  maxF0RmseSemitones: 'worst f0 RMSE (semitones)',
  timingErrorMs: 'mean timing error (ms)',
  maxTimingErrorMs: 'worst timing error (ms)',
  phonemeAgreement: 'phonemes of the copy agreeing',
  modeShare: 'share of modes recognised',
  peakRssMb: 'peak RSS (MB)',
  textBack: 'text recognised back',
  workerRtf: 'synthesis worker real-time factor',
  firstSound: 'first sound (s)',
};

export function passes(name, value, limit) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return false;
  }
  return MINIMUMS.has(name) ? value >= limit : value <= limit;
}

/** The run of a column: quality and js-1 come from the js run. */
function runFor(runs, row, column) {
  return runs[row]?.[column === 'rust-1' ? 'rust' : 'js'];
}

function memoryCell(runs, row, limits) {
  const measured = ['js', 'rust']
    .map((engine) => runs[row]?.[engine])
    .filter((run) => run && !run.unavailable);
  if (!measured.length) {
    return { status: 'unavailable', reason: 'no run measured memory' };
  }
  const crashed = measured.filter((run) => run.capped?.crashed);
  const peaks = measured.map((run) => run.peakRssMb).filter(Number.isFinite);
  const value = peaks.length ? Math.max(...peaks) : null;
  const limit = limits.peakRssMb;
  const pass = !crashed.length && passes('peakRssMb', value, limit);
  return {
    status: pass ? 'certified' : 'failed',
    metrics: { peakRssMb: { value, limit, pass } },
    ...(crashed.length && {
      reason: crashed
        .map((run) => `${run.engine}: ${run.capped.crashed}`)
        .join('; '),
    }),
  };
}

function cellFor(runs, row, column, limits) {
  if (column === 'memory') {
    return memoryCell(runs, row, limits);
  }
  const run = runFor(runs, row, column);
  if (!run) {
    return { status: 'unavailable', reason: 'not run' };
  }
  if (run.unavailable) {
    return { status: 'unavailable', reason: run.unavailable };
  }
  if (run.error) {
    return { status: 'failed', reason: run.error, metrics: {} };
  }
  if (!Object.keys(limits).length) {
    // Issue 81: the speed of copy synthesis is reported, with no limit.
    const ratio = run.metrics?.cpuRatio;
    return {
      status: 'certified',
      reason: `reported, no limit${Number.isFinite(ratio) ? `: CPU time / audio time ${format(ratio)}` : ''}`,
      metrics: {},
    };
  }
  const metrics = Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => {
      const value = run.metrics?.[name] ?? null;
      return [name, { value, limit, pass: passes(name, value, limit) }];
    })
  );
  // An uncapped retry provides diagnostics for recognition speed. For
  // certification, both engines must reach the limit under the heap cap.
  const crashed =
    row === 'recognition' && (column === 'js-1' || column === 'rust-1')
      ? run.capped?.crashed
      : null;
  const pass =
    !crashed && Object.values(metrics).every((metric) => metric.pass);
  return {
    status: pass ? 'certified' : 'failed',
    metrics,
    ...(crashed && { reason: `192 MB heap cap: ${crashed}` }),
  };
}

/**
 * Judge every row and column with limits against the measured runs, shaped
 * {row: {js, rust}} with the printed results of scripts/lowest-settings.mjs.
 */
export function judge(runs, thresholds, issues = {}) {
  const cells = {};
  for (const [row, columns] of Object.entries(thresholds)) {
    cells[row] = {};
    for (const column of COLUMNS) {
      if (!columns[column]) {
        continue;
      }
      cells[row][column] = cellFor(runs, row, column, columns[column]);
    }
  }
  return linkIssues(cells, issues);
}

/** Attach the filed issues to the cells that are not certified. */
export function linkIssues(cells, issues) {
  for (const [row, columns] of Object.entries(cells)) {
    for (const [column, cell] of Object.entries(columns)) {
      const issue = issues[`${row}/${column}`];
      if (issue && cell.status !== 'certified') {
        cell.issue = issue;
      } else {
        delete cell.issue;
      }
    }
  }
  return cells;
}

/** Cells certified in `before` and not certified in `after`. */
export function regressions(before, after, { failedOnly = false } = {}) {
  const found = [];
  for (const [row, columns] of Object.entries(before?.cells ?? {})) {
    for (const [column, cell] of Object.entries(columns)) {
      const now = after.cells?.[row]?.[column];
      const status = now?.status ?? 'unavailable';
      if (
        cell.status === 'certified' &&
        status !== 'certified' &&
        (!failedOnly || status === 'failed')
      ) {
        found.push({ row, column, status });
      }
    }
  }
  return found;
}

function format(value, maxLength = Infinity) {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '∞';
  }
  const text = String(value).replaceAll('|', '\\|');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function status(cell) {
  if (!cell) {
    return '—';
  }
  return cell.issue ? `[${cell.status}](${cell.issue})` : cell.status;
}

function matrix(data, link = (cell) => status(cell)) {
  return [
    '| Row | quality | js-1 | rust-1 | memory |',
    '| --- | --- | --- | --- | --- |',
    ...Object.entries(data.cells).map(
      ([row, cells]) =>
        `| ${row} | ${COLUMNS.map((column) => link(cells[column])).join(' | ')} |`
    ),
  ];
}

function details(data) {
  const lines = [
    '| Row | Column | Metric | Value | Limit | Pass |',
    '| --- | --- | --- | ---: | ---: | --- |',
  ];
  for (const [row, cells] of Object.entries(data.cells)) {
    for (const [column, cell] of Object.entries(cells)) {
      const metrics = Object.entries(cell.metrics ?? {});
      if (!metrics.length) {
        lines.push(
          `| ${row} | ${column} | ${cell.reason ?? 'no limit'} | — | — | ${cell.status} |`
        );
      }
      for (const [name, { value, limit, pass }] of metrics) {
        const sign = MINIMUMS.has(name) ? '≥' : '≤';
        lines.push(
          `| ${row} | ${column} | ${METRICS[name] ?? name} | ${format(value)} | ${sign} ${format(limit)} | ${pass ? 'yes' : 'no'} |`
        );
      }
    }
  }
  return lines;
}

function runLines(data) {
  const lines = [
    '| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
  ];
  for (const [row, engines] of Object.entries(data.runs)) {
    for (const [engine, run] of Object.entries(engines)) {
      if (run.unavailable) {
        lines.push(
          `| ${row} | ${engine} | — | — | — | — | unavailable: ${run.unavailable} |`
        );
        continue;
      }
      const cap = run.capped?.crashed
        ? `crashed at 192 MB (${run.capped.crashed}); rerun without the cap`
        : run.capped
          ? '192 MB'
          : 'none';
      const extra = Object.entries(run.metrics ?? {})
        .filter(([, value]) => typeof value !== 'object' || value === null)
        // Long texts (the recognised words) are cut; the JSON has them.
        .map(([name, value]) => `${name} ${format(value, 60)}`)
        .join(', ');
      lines.push(
        `| ${row} | ${engine} | ${format(run.seconds)} | ${format(run.audioSeconds)} | ${format(run.peakRssMb)} | ${cap} | ${run.error ? `error: ${run.error}` : extra} |`
      );
    }
  }
  return lines;
}

/** The Markdown report of a judged matrix. */
export function formatReport(data) {
  const rowMeasurements = Object.entries(data.rowMeasurements ?? {});
  const measurementLines = rowMeasurements.length
    ? [
        '',
        '## Targeted reruns',
        '',
        ...rowMeasurements.flatMap(([row, run]) => [
          `- **${row}** at commit \`${run.commit}\` on ${run.cpu}, Node ${run.node}, measured ${run.measured}.`,
          `  ${run.pinned ? `Pinned with \`taskset -c ${run.core}\`.` : 'Run without CPU pinning.'} Command \`${run.command}\`.`,
        ]),
      ]
    : [];
  const regressionLines = data.regressions?.length
    ? [
        '',
        '## Regressions',
        '',
        ...data.regressions.map(
          ({ row, column, status: now, reason }) =>
            `- ${row} / ${column} is ${now}, certified before. Reason: ${reason}`
        ),
      ]
    : [];
  return [
    '# Lowest settings: 8 kHz and one core',
    '',
    'Every row runs on 8000 Hz audio in its own Node process with',
    '`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are',
    'converted with `resample`. The Rust engine runs with one thread and no',
    'SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever',
    'become stricter.',
    '',
    `- Measured: ${data.measured}`,
    `- Commit: \`${data.commit}\``,
    `- Command: \`${data.command}\``,
    `- CPU: ${data.cpu}`,
    `- Node: ${data.node}`,
    `- Pinning: ${data.pinned ? `pinned with \`taskset -c ${data.core}\`` : 'not pinned (taskset is missing)'}`,
    `- Heap cap: \`--max-old-space-size=192\`${data.limit ? `; item limit ${data.limit}` : ''}`,
    '',
    ...matrix(data),
    '',
    '## Values and limits',
    '',
    ...details(data),
    '',
    '## Runs',
    '',
    ...runLines(data),
    ...measurementLines,
    ...regressionLines,
    '',
  ].join('\n');
}

/** The README block between the lowest-settings markers. */
export function readmeTable(data) {
  const measured = Object.keys(data.rowMeasurements ?? {}).length
    ? 'Full matrix measured'
    : 'Measured';
  return [
    README_START,
    // Prettier would pad the columns; the block stays exactly as generated.
    '<!-- prettier-ignore-start -->',
    ...matrix(data, (cell) => (cell ? cell.status : '—')),
    '',
    `${measured} at commit \`${data.commit.slice(0, 7)}\` on ${data.cpu}. See the [report](${REPORT_PATH}).`,
    '<!-- prettier-ignore-end -->',
    README_END,
  ].join('\n');
}

/** Replace the lowest-settings block of a README. */
export function replaceReadmeTable(readme, data) {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < start) {
    throw new Error(
      `README is missing ${README_START} and ${README_END} markers`
    );
  }
  return (
    readme.slice(0, start) +
    readmeTable(data) +
    readme.slice(end + README_END.length)
  );
}
