/**
 * Heavy check (issue 24): 2000 bare kernel steps of the 3D solver on five
 * grids (`dx` 1, 0.5 and 0.4 of the default head; `dx` 1 and 0.5 in a
 * 40 cm enclosure) with 1, 2, 3 and 4 threads, natively and in
 * WebAssembly, median of three runs, and the value of THREAD_MIN_LINKS
 * that the rule of the issue gives: the link count of the smallest grid
 * where 2 threads are at least 1.3 times faster than 1, else `usize::MAX`.
 * A team must pay on both platforms, because the one constant of
 * crates/voice-simulator-core/src/fdtd/parallel.rs serves both. Writes
 * `performance-threads.md` / `.json`, copied to `docs/reports/`.
 *
 * Native: `voice-simulator-cli kernel-steps <job> 2000 --threads <n>`
 * (VOICE_SIMULATOR_CLI, else target/release; `cargo build --release -p
 * voice-simulator-cli`), a new process per run. WebAssembly:
 * src/engine/voice-simulator-threads.wasm (`node scripts/build-wasm.mjs
 * --threads`), one engine per thread count (1 is the same file without
 * helpers), `vs_renderer_kernel_steps` in a team of `vs_team_new_from(...,
 * 0)`. Both first render the first 480 samples of 'Hello.' so that the
 * field is not all zeros, and check that every thread count leaves the
 * same field. Skipped with a visible reason without the files;
 * REQUIRE_CLI=1 and REQUIRE_THREADS_WASM=1 turn that into an error.
 * HEAVY_LIMIT limits the number of grids (smallest first).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { describe, expect, it as alwaysIt } from 'test-anywhere';

import {
  RustVoiceRenderer,
  renderJob,
  withTeam,
} from '../../src/engine/rust-renderer.js';
import {
  createSharedMemory,
  defaultThreadsEngineUrl,
  loadEngineModule,
} from '../../src/engine/wasm-loader.js';
import { prepareUtterance } from '../../src/synthesize.js';
import { noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const env = globalThis.process?.env ?? {};

const TEXT = 'Hello.';
const STEPS = 2000;
const RUNS = 3;
const THREADS = [1, 2, 3, 4];
/** Samples rendered before the timed steps, KERNEL_WARM_SAMPLES of the CLI. */
const WARM_SAMPLES = 480;
/** Speed-up of 2 threads over 1 from which a grid gets a team. */
const RULE_SPEED_UP = 1.3;
const BOX = Object.freeze({ width: 40, height: 40, depth: 40 });
const GRIDS = Object.freeze(
  [
    { name: 'dx 1', tier: 'high' },
    { name: 'dx 0.5', tier: 'studio' },
    { name: 'dx 0.4', tier: 'reference' },
    { name: 'dx 1, 40 cm box', tier: 'high', enclosure: BOX },
    { name: 'dx 0.5, 40 cm box', tier: 'studio', enclosure: BOX },
  ].slice(0, heavyLimit(5))
);

const cliCandidates = [
  env.VOICE_SIMULATOR_CLI,
  path.join(root, 'target/release/voice-simulator-cli'),
];
const cli = cliCandidates.find((file) => file && existsSync(file)) ?? null;
if (env.REQUIRE_CLI === '1' && !cli) {
  throw new Error(
    'REQUIRE_CLI=1 but target/release/voice-simulator-cli is missing; run cargo build --release -p voice-simulator-cli'
  );
}
const threadsFile = existsSync(defaultThreadsEngineUrl());
if (env.REQUIRE_THREADS_WASM === '1' && !threadsFile) {
  throw new Error(
    'REQUIRE_THREADS_WASM=1 but src/engine/voice-simulator-threads.wasm is missing; run node scripts/build-wasm.mjs --threads'
  );
}
const noCli = cli
  ? null
  : 'no release voice-simulator-cli; run cargo build --release -p voice-simulator-cli';
const noThreads =
  noRust ??
  (!threadsFile
    ? 'no threads build; run node scripts/build-wasm.mjs --threads (nightly Rust)'
    : !createSharedMemory()
      ? 'this runtime cannot create a shared WebAssembly memory'
      : null);

/** Results per platform: one row per grid. */
const rows = { native: [], wasm: [] };

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function prepare(grid) {
  return prepareUtterance(TEXT, {
    tier: grid.tier,
    seed: 1,
    ...(grid.enclosure ? { enclosure: grid.enclosure } : {}),
  });
}

/** Steps per second and the speed-up over 1 thread, per thread count. */
function summarise(grid, links, seconds, fieldsAgree) {
  const stepsPerSecond = {};
  const speedUp = {};
  for (const threads of THREADS) {
    stepsPerSecond[threads] = STEPS / median(seconds[threads]);
  }
  for (const threads of THREADS) {
    speedUp[threads] = stepsPerSecond[threads] / stepsPerSecond[1];
  }
  return {
    grid: grid.name,
    tier: grid.tier,
    enclosure: grid.enclosure ?? null,
    links,
    stepsPerSecond,
    speedUp,
    fieldsAgree,
    seconds,
  };
}

/** One `kernel-steps` run of the CLI. */
function nativeRun(file, threads) {
  const result = spawnSync(
    cli,
    ['kernel-steps', file, String(STEPS), '--threads', String(threads)],
    { encoding: 'utf8' }
  );
  expect(result.status).toBe(0);
  const value = (key) => new RegExp(`^${key} (\\S+)$`, 'm').exec(result.stdout);
  expect(Number(value('threads')[1])).toBe(threads);
  return {
    seconds: Number(value('seconds')[1]),
    links: Number(value('links')[1]),
    field: value('field_sha256')[1],
  };
}

function measureNative(grid) {
  const { plan, renderOptions } = prepare(grid);
  const folder = mkdtempSync(path.join(tmpdir(), 'performance-threads-'));
  try {
    const file = path.join(folder, 'grid.job');
    writeFileSync(file, renderJob(plan, renderOptions).bytes);
    const seconds = Object.fromEntries(THREADS.map((n) => [n, []]));
    const fields = new Set();
    let links = 0;
    for (let run = 0; run < RUNS; run++) {
      for (const threads of THREADS) {
        const result = nativeRun(file, threads);
        seconds[threads].push(result.seconds);
        fields.add(result.field);
        links = result.links;
      }
    }
    return summarise(grid, links, seconds, fields.size === 1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Engines of the threads file with 1 to 4 threads, loaded once. */
let engines;
async function threadEngines() {
  engines ??= Promise.all(
    THREADS.map((threads) =>
      loadEngineModule(defaultThreadsEngineUrl(), { threads })
    )
  );
  const loaded = await engines;
  loaded.forEach((engine, index) => {
    expect(engine.threads).toBe(THREADS[index]);
  });
  return loaded;
}

/** SHA-256 of the bits of the pressure field of `renderer`. */
function fieldSha256(renderer) {
  const { pressure } = renderer.field();
  return createHash('sha256')
    .update(new Uint8Array(pressure.buffer, pressure.byteOffset))
    .digest('hex');
}

async function measureWasm(grid) {
  const loaded = await threadEngines();
  const { plan, renderOptions } = prepare(grid);
  const renderers = loaded.map(
    (engine) => new RustVoiceRenderer(engine, plan, renderOptions)
  );
  try {
    for (const renderer of renderers) {
      renderer.render(new Float32Array(WARM_SAMPLES));
    }
    const { exports } = loaded[0];
    const links = exports.vs_renderer_links(renderers[0].handle);
    const seconds = Object.fromEntries(THREADS.map((n) => [n, []]));
    for (let run = 0; run < RUNS; run++) {
      renderers.forEach((renderer, index) => {
        const engine = loaded[index];
        const timed = withTeam(
          engine,
          renderer.handle,
          () => {
            const start = performance.now();
            const code = engine.exports.vs_renderer_kernel_steps(
              renderer.handle,
              STEPS
            );
            expect(code).toBe(0);
            return (performance.now() - start) / 1000;
          },
          0
        );
        expect(timed.threads).toBe(THREADS[index]);
        seconds[THREADS[index]].push(timed.result);
      });
    }
    const fields = new Set(renderers.map(fieldSha256));
    return summarise(grid, links, seconds, fields.size === 1);
  } finally {
    for (const renderer of renderers) {
      renderer.free();
    }
  }
}

/**
 * The rule of the issue on the `rows` of one platform: the links of the
 * smallest grid where 2 threads are at least RULE_SPEED_UP times faster,
 * else null (`usize::MAX`).
 */
function ruleMinLinks(platformRows) {
  const paying = platformRows
    .filter((row) => row.speedUp[2] >= RULE_SPEED_UP)
    .map((row) => row.links);
  return paying.length > 0 ? Math.min(...paying) : null;
}

/** The value of THREAD_MIN_LINKS in parallel.rs: a number, or null for usize::MAX. */
function sourceMinLinks() {
  const source = readFileSync(
    path.join(root, 'crates/voice-simulator-core/src/fdtd/parallel.rs'),
    'utf8'
  );
  const value = /pub const THREAD_MIN_LINKS: usize = ([^;]+);/.exec(
    source
  )?.[1];
  return value === 'usize::MAX' ? null : Number(value?.replaceAll('_', ''));
}

function shown(links) {
  return links === null ? '`usize::MAX`' : links.toLocaleString('en');
}

function table(platform, platformRows) {
  return [
    `### ${platform}`,
    '',
    '| Grid | Links | Steps/s 1 | 2 | 3 | 4 | Speed-up 2 | 3 | 4 | Same field |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...platformRows.map(
      (row) =>
        `| ${row.grid} | ${row.links.toLocaleString('en')} | ${THREADS.map((n) => row.stepsPerSecond[n].toFixed(1)).join(' | ')} | ${[2, 3, 4].map((n) => `${row.speedUp[n].toFixed(2)}×`).join(' | ')} | ${row.fieldsAgree ? 'yes' : 'NO'} |`
    ),
    '',
  ];
}

describe('performance of the 3D solver on several threads (issue 24)', () => {
  for (const grid of GRIDS) {
    itUnless(noCli)(`${grid.name}: native`, () => {
      const row = measureNative(grid);
      expect(row.fieldsAgree).toBe(true);
      rows.native.push(row);
    });
    itUnless(noThreads)(`${grid.name}: WebAssembly`, async () => {
      const row = await measureWasm(grid);
      expect(row.fieldsAgree).toBe(true);
      rows.wasm.push(row);
    });
  }

  alwaysIt('writes the report', async () => {
    for (const engine of (await engines) ?? []) {
      engine.close();
    }
    const problems = [noCli, noThreads].filter(Boolean);
    if (rows.native.length === 0 && rows.wasm.length === 0) {
      globalThis.console.log(
        `performance-threads skipped: ${problems.join('; ')}`
      );
      return;
    }
    const byRows = (platformRows) =>
      platformRows.length === GRIDS.length ? ruleMinLinks(platformRows) : null;
    const native = byRows(rows.native);
    const wasm = byRows(rows.wasm);
    const complete =
      rows.native.length === GRIDS.length && rows.wasm.length === GRIDS.length;
    // Both platforms must pay: the larger value, and usize::MAX when either
    // has no grid that pays.
    const rule =
      native === null || wasm === null ? null : Math.max(native, wasm);
    const source = sourceMinLinks();
    const decision = complete
      ? `The rule gives THREAD_MIN_LINKS = ${shown(rule)} (native ${shown(native)}, WebAssembly ${shown(wasm)}); parallel.rs has ${shown(source)}${rule === source ? ', the same.' : ': DIFFERENT.'}`
      : `Not every grid was measured on both platforms (${problems.join('; ') || `HEAVY_LIMIT ${GRIDS.length}`}): no decision.`;
    const markdown = [
      '## 3D solver on several threads: kernel steps',
      '',
      `${STEPS} bare kernel steps after the first ${WARM_SAMPLES} samples of "${TEXT}" (seed 1), median of ${RUNS} runs, Node.js ${process.version}, ${process.platform} ${process.arch}, ${globalThis.navigator?.hardwareConcurrency ?? '?'} logical cores. Speed-up = steps per second on n threads / on 1 thread. Native = \`voice-simulator-cli kernel-steps\`; WebAssembly = src/engine/voice-simulator-threads.wasm (1 thread: the same file without helpers). Rule: THREAD_MIN_LINKS = links of the smallest grid where 2 threads are at least ${RULE_SPEED_UP}× faster than 1, on both platforms; else \`usize::MAX\`.`,
      '',
      ...table('Native', rows.native),
      ...table('WebAssembly', rows.wasm),
      decision,
      '',
    ].join('\n');
    writeReport('performance-threads', markdown, {
      text: TEXT,
      seed: 1,
      steps: STEPS,
      runs: RUNS,
      warmSamples: WARM_SAMPLES,
      runtime: `node ${process.version}`,
      platform: `${process.platform}-${process.arch}`,
      cores: globalThis.navigator?.hardwareConcurrency ?? null,
      ruleSpeedUp: RULE_SPEED_UP,
      threadMinLinks: { native, wasm, rule, source },
      decision,
      native: rows.native,
      wasm: rows.wasm,
    });
  });
});
