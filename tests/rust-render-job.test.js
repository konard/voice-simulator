/**
 * Render jobs of the Rust renderer (issue 22): `renderJob` writes the
 * configuration and every frame of a render as little-endian f64 values,
 * WebAssembly renders a job in one call like RustVoiceRenderer renders the
 * plan, and `voice-simulator-cli render-job` renders the same job natively
 * with the same SHA-256.
 *
 * The WebAssembly tests skip without src/engine/voice-simulator.wasm (see
 * ./helpers/rust-engine.js). The CLI test needs the binary: it uses
 * VOICE_SIMULATOR_CLI, else target/release or target/debug, and skips
 * without one unless REQUIRE_CLI=1, which CI sets after building it.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it as alwaysIt } from 'test-anywhere';

import {
  renderJob,
  renderJobRust,
  renderPlanRust,
} from '../src/engine/rust-renderer.js';
import { RENDERER_CONFIG } from '../src/engine/layout.js';
import { prepareUtterance } from '../src/synthesize.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = globalThis.process?.env ?? {};

/** The CLI binary, or null. */
function findCli() {
  const candidates = [
    env.VOICE_SIMULATOR_CLI,
    path.join(root, 'target/release/voice-simulator-cli'),
    path.join(root, 'target/debug/voice-simulator-cli'),
  ];
  return candidates.find((file) => file && existsSync(file)) ?? null;
}

const cli = findCli();
if (env.REQUIRE_CLI === '1' && !cli) {
  throw new Error(
    'REQUIRE_CLI=1 but voice-simulator-cli is missing; run cargo build --release -p voice-simulator-cli'
  );
}
const noCli =
  noRust ??
  (cli
    ? null
    : 'no voice-simulator-cli; run cargo build --release -p voice-simulator-cli');

/** SHA-256 of the little-endian bytes of a Float32Array. */
function sha256(samples) {
  return createHash('sha256')
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    )
    .digest('hex');
}

function helloJob(tier) {
  const { plan, renderOptions } = prepareUtterance('Hello world.', {
    tier,
    seed: 1,
  });
  return { plan, renderOptions, job: renderJob(plan, renderOptions) };
}

describe('Rust render jobs (issue 22)', () => {
  alwaysIt('renderJob lays out config, frames and sample count', () => {
    const { job } = helloJob('minimal');
    const view = new DataView(job.bytes.buffer);
    const value = (index) => view.getFloat64(index * 8, true);
    const configLength = job.config.length;
    expect(value(0)).toBe(configLength);
    expect(value(1 + RENDERER_CONFIG.TOTAL_SAMPLES)).toBe(job.samples);
    expect(value(1 + configLength)).toBe(job.frameCount);
    const total = job.bytes.length / 8;
    expect(total).toBe(configLength + job.frames.length + 3);
    expect(value(total - 1)).toBe(job.samples);
    const blockSize = job.config[RENDERER_CONFIG.BLOCK_SIZE];
    expect(job.frameCount).toBe(Math.ceil(job.samples / blockSize));
  });

  itUnless(noRust)('a job renders like the plan', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions, job } = helloJob('minimal');
    const fromJob = renderJobRust(engine, job);
    const fromPlan = renderPlanRust(engine, plan, renderOptions);
    expect(sha256(fromJob)).toBe(sha256(fromPlan));
  });

  itUnless(noCli)(
    'voice-simulator-cli render-job prints the WebAssembly SHA-256',
    async () => {
      const engine = await loadRustEngine();
      const folder = mkdtempSync(path.join(tmpdir(), 'render-job-'));
      try {
        for (const tier of ['minimal', 'low', 'medium']) {
          const { job } = helloJob(tier);
          const file = path.join(folder, `${tier}.job`);
          writeFileSync(file, job.bytes);
          const result = spawnSync(cli, ['render-job', file], {
            encoding: 'utf8',
          });
          expect(result.status).toBe(0);
          const printed = /^sha256 ([0-9a-f]{64})$/m.exec(result.stdout)?.[1];
          const wasm = sha256(renderJobRust(engine, job));
          globalThis.console.log(`render-job (${tier}) ${printed} ${wasm}`);
          expect(printed).toBe(wasm);
          expect(result.stdout).toMatch(/^samples \d+$/m);
          expect(result.stdout).toMatch(/^seconds [\d.]+$/m);
        }
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );
});
