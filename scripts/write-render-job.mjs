#!/usr/bin/env node

/**
 * Writes a render job for `voice-simulator-cli render-job` (issue 22).
 *
 * JavaScript plans the utterance and computes the configuration and the
 * frame of every control block (`renderJob` of src/engine/rust-renderer.js);
 * the job file holds them as little-endian f64 values: config length,
 * config, frame count, frames, sample count. The CLI then renders the job
 * natively, so the native speed can be compared with WebAssembly.
 *
 * Usage:
 *   node scripts/write-render-job.mjs <text> <tier> <out> [--seed <seed>]
 *
 * <tier> is an audio tier with the waveguide solver (minimal, low,
 * medium); the seed is 1 by default. When src/engine/voice-simulator.wasm
 * has been built (npm run build:wasm), the script also renders the job
 * with it and prints the SHA-256 of the samples, which
 * `voice-simulator-cli render-job <out>` must print too.
 *
 * Exit codes: 0 ok, 2 wrong usage or a tier the Rust renderer cannot run.
 */

import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

import { renderJob, renderJobRust } from '../src/engine/rust-renderer.js';
import {
  defaultEngineUrl,
  loadEngineModule,
} from '../src/engine/wasm-loader.js';
import { prepareUtterance } from '../src/synthesize.js';

const USAGE =
  'Usage: node scripts/write-render-job.mjs <text> <tier> <out> [--seed <seed>]';

/** The arguments, or null for wrong usage. */
function parseArguments(args) {
  const positional = [];
  let seed = 1;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--seed' && index + 1 < args.length) {
      seed = args[++index];
    } else if (args[index].startsWith('--')) {
      return null;
    } else {
      positional.push(args[index]);
    }
  }
  if (positional.length !== 3) {
    return null;
  }
  const [text, tier, out] = positional;
  return { text, tier, out, seed: /^\d+$/.test(seed) ? Number(seed) : seed };
}

/** SHA-256 of the bytes of `samples` (little-endian f32). */
function samplesSha256(samples) {
  return createHash('sha256')
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    )
    .digest('hex');
}

async function main() {
  const parsed = parseArguments(globalThis.process.argv.slice(2));
  if (!parsed) {
    globalThis.console.error(USAGE);
    return 2;
  }
  const { text, tier, out, seed } = parsed;
  let job;
  try {
    const { plan, renderOptions } = prepareUtterance(text, { tier, seed });
    job = renderJob(plan, renderOptions);
  } catch (error) {
    globalThis.console.error(`write-render-job: ${error.message}`);
    return 2;
  }
  writeFileSync(out, job.bytes);
  const log = globalThis.console.log;
  log(`wrote ${out}: ${job.bytes.length} bytes`);
  log(`config ${job.config.length} values, ${job.frameCount} frames`);
  log(`samples ${job.samples}`);
  if (existsSync(defaultEngineUrl())) {
    const engine = await loadEngineModule();
    const started = globalThis.performance.now();
    const samples = renderJobRust(engine, job);
    const seconds = (globalThis.performance.now() - started) / 1000;
    log(`wasm sha256 ${samplesSha256(samples)}`);
    log(`wasm seconds ${seconds.toFixed(6)}`);
  }
  return 0;
}

globalThis.process.exitCode = await main();
