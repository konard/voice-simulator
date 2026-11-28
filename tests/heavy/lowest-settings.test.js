/**
 * Lowest-settings certification (issue 81): every row of the matrix with
 * the js and the scalar single-thread Rust engine, one process each, pinned
 * to one core with a 192 MB heap cap. Writes reports/heavy/lowest-settings.
 * Unlicense.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { fetchDataset } from '../../scripts/datasets.mjs';
import {
  formatReport,
  judge,
  passes,
  regressions,
  REPORT_PATH,
} from '../../scripts/lowest-report.mjs';
import { ISSUES_PATH } from '../../scripts/lowest-settings.mjs';
import { BENCHMARK } from './helpers/benchmark.js';
import { heavyLimit, heavyOut, writeReport } from './helpers/report.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ALL_ROWS = [
  'synthesis',
  'recognition',
  'streaming',
  'voice-fit',
  'session',
  'copy',
  'modes',
];
const selected = process.env.LOWEST_ROW || null;
assert.ok(
  !selected || ALL_ROWS.includes(selected),
  `Unknown lowest row: ${selected}`
);
const rows = selected ? [selected] : ALL_ROWS;
const ENGINES = ['js', 'rust'];
const HEAP_CAP = '--max-old-space-size=192';
const STREAM_SECONDS = 60;
const ROW_TIMEOUT_MS = 6 * 3_600_000;
const read = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const thresholds = read(path.join(ROOT, 'tests/heavy/lowest-thresholds.json'));
const limit = heavyLimit(Infinity);
const out = path.join(heavyOut(), 'lowest-settings');
// One core unless LOWEST_PARALLEL spreads the processes over more cores.
const parallel = Math.max(
  1,
  Math.min(os.availableParallelism(), Number(process.env.LOWEST_PARALLEL) || 1)
);
const pinned =
  spawnSync('taskset', ['-c', '0', 'true'], { stdio: 'ignore' }).status === 0;

function command(row, engine, cap) {
  const args = [
    ...(cap ? [HEAP_CAP] : []),
    'scripts/lowest-settings.mjs',
    '--row',
    row,
    '--engine',
    engine,
    '--out',
    out,
    ...(Number.isFinite(limit) ? ['--limit', String(limit)] : []),
  ];
  return args;
}

function run(row, engine, core, cap) {
  const node = command(row, engine, cap);
  const [file, args] = pinned
    ? ['taskset', ['-c', String(core), process.execPath, ...node]]
    : [process.execPath, node];
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: ROOT,
      env: { ...process.env, UV_THREADPOOL_SIZE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const line = stdout.trim().split('\n').at(-1);
      let result;
      try {
        result = code === 0 ? JSON.parse(line) : null;
      } catch {
        result = null;
      }
      resolve({ code, signal, result, stderr });
    });
  });
}

const OUT_OF_MEMORY = /heap out of memory|Reached heap limit/u;
let recognitionCache;

async function prepareRecognitionCache() {
  for (const { id, rows } of BENCHMARK.sets) {
    await fetchDataset(id, { limit: Math.min(rows, limit) });
  }
}

function measurementError(row, engine, attempt) {
  const exit = attempt.code ?? attempt.signal;
  const diagnostic = attempt.stderr.trim();
  console.error(`lowest ${row} ${engine} exited ${exit}\n${diagnostic}`);
  const lines = diagnostic.split('\n');
  const detail = lines.find((line) =>
    /(?:Error|Exception)(?: \[[^\]]+\])?: /u.test(line)
  );
  return `exit ${exit}: ${detail ?? lines[0]}`;
}

/**
 * Run a cell under the heap cap. When the capped process runs out of heap,
 * the memory cell fails and the row runs again without the cap, still on
 * one core, so the other columns are measured.
 */
async function measure(row, engine, core) {
  if (row === 'recognition') {
    // Both engines read the same files. Only the parent may fetch missing
    // recordings so the children never write to a shared partial download.
    recognitionCache ??= prepareRecognitionCache();
    try {
      await recognitionCache;
    } catch (error) {
      return { row, engine, error: error.message, capped: {} };
    }
  }
  const capped = await run(row, engine, core, true);
  if (capped.result) {
    return { ...capped.result, capped: {} };
  }
  const crash = OUT_OF_MEMORY.test(capped.stderr)
    ? 'JavaScript heap out of memory'
    : null;
  if (!crash) {
    return {
      row,
      engine,
      error: measurementError(row, engine, capped),
      capped: {},
    };
  }
  const free = await run(row, engine, core, false);
  return free.result
    ? { ...free.result, capped: { crashed: crash } }
    : {
        row,
        engine,
        error: `uncapped ${measurementError(row, engine, free)}`,
        capped: { crashed: crash },
      };
}

// A small pool: each process gets its own core.
const cores = Array.from({ length: parallel }, (_, i) => i);
const waiting = [];
function withCore(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      const core = cores.shift();
      task(core)
        .then(resolve, reject)
        .finally(() => {
          cores.push(core);
          waiting.shift()?.();
        });
    };
    if (cores.length) {
      start();
    } else {
      waiting.push(start);
    }
  });
}

const runs = {};
const pending = new Map();
for (const row of rows) {
  for (const engine of ENGINES) {
    pending.set(`${row}-${engine}`, () =>
      withCore((core) => measure(row, engine, core))
    );
  }
}
// With LOWEST_PARALLEL the processes start together; else one by one.
const started = new Map();
const result = (key) => {
  if (!started.has(key)) {
    started.set(key, pending.get(key)());
  }
  return started.get(key);
};
if (parallel > 1) {
  for (const key of pending.keys()) {
    result(key);
  }
}

function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

describe('lowest settings: 8 kHz and one core', () => {
  mkdirSync(out, { recursive: true });
  for (const row of rows) {
    for (const engine of ENGINES) {
      // A full row can take hours on one core: recognition scores 140
      // benchmark utterances at 8 kHz and once more at 16 kHz.
      it(`${row} with ${engine}`, { timeout: ROW_TIMEOUT_MS }, async () => {
        const measured = await result(`${row}-${engine}`);
        runs[row] ??= {};
        runs[row][engine] = measured;
        console.log(`lowest ${row} ${engine}`, JSON.stringify(measured));
        assert.ok(!measured.error, measured.error);
        if (row === 'streaming' && !Number.isFinite(limit)) {
          certifyStreaming(engine, measured);
        }
        if (
          row === 'session' &&
          !Number.isFinite(limit) &&
          (selected || !measured.unavailable)
        ) {
          const { quality, [engine === 'js' ? 'js-1' : 'rust-1']: speed } =
            thresholds.session;
          assert.ok(pinned, 'Session certification requires one pinned core');
          assert.ok(!measured.unavailable, measured.unavailable);
          assert.ok(
            !measured.capped?.crashed,
            'Session must run with the heap cap'
          );
          assert.equal(measured.audioSeconds, 60);
          assert.deepEqual(
            measured.cases?.map(({ preset }) => preset),
            ['male', 'female', 'child']
          );
          for (const { preset, stableAt, words } of measured.cases) {
            assert.ok(
              stableAt > 0 && stableAt < 20,
              `${engine} ${preset} should reach stable during input`
            );
            assert.ok(
              words > 0,
              `${engine} ${preset} should commit recognized words`
            );
          }
          for (const [metric, maximum] of Object.entries({
            ...quality,
            ...speed,
          })) {
            const value = measured.metrics?.[metric];
            assert.ok(
              passes(metric, value, maximum),
              `${engine} session ${metric}: ${value}, limit ${maximum}`
            );
          }
        }
      });
    }
  }

  after(() => {
    // The app row comes from tests/heavy/lowest-app.test.js, run before.
    const app = !selected && read(path.join(heavyOut(), 'lowest-app.json'));
    if (app) {
      runs.app = { js: app.result };
    }
    const issues = read(path.join(ROOT, ISSUES_PATH)) ?? {};
    const data = {
      version: 1,
      measured: new Date().toISOString(),
      commit: commit(),
      command: `${selected ? `LOWEST_ROW=${selected} node --test tests/heavy/lowest-settings.test.js` : 'node scripts/run-heavy.mjs --suite lowest'}${Number.isFinite(limit) && !selected ? ` --limit ${limit}` : ''}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      node: process.version,
      pinned,
      core: pinned ? 0 : null,
      parallel,
      limit: Number.isFinite(limit) ? limit : null,
      ...(selected && { row: selected }),
      limits: thresholds,
      runs,
      cells: judge(runs, thresholds, issues),
      regressions: [],
    };
    writeReport('lowest-settings', formatReport(data), data);
    if (Number.isFinite(limit)) {
      // A run on fewer utterances is a smoke test, not the certification.
      console.log(`lowest: --limit ${limit}, committed cells not compared`);
      return;
    }
    const committed = read(
      path.join(ROOT, REPORT_PATH.replace(/\.md$/u, '.json'))
    );
    const lost = regressions(committed, data, { failedOnly: true });
    assert.deepEqual(
      lost,
      [],
      'certified cells of the committed report failed'
    );
  });
});

function certifyStreaming(engine, measured) {
  assert.ok(pinned, 'Streaming certification requires one pinned core');
  assert.ok(!measured.unavailable, measured.unavailable);
  assert.ok(
    !measured.capped?.crashed,
    `streaming ${engine}: ${measured.capped?.crashed}`
  );
  assert.equal(measured.audioSeconds, STREAM_SECONDS, `streaming ${engine}`);
  const limits = {
    ...thresholds.streaming.quality,
    ...thresholds.streaming[`${engine}-1`],
  };
  for (const [name, limit] of Object.entries(limits)) {
    const value = measured.metrics?.[name];
    assert.ok(
      passes(name, value, limit),
      `streaming ${engine} ${name}: ${value} exceeds ${limit}`
    );
  }
}
