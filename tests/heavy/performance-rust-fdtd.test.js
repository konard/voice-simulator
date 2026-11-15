/**
 * Heavy check (issue 23): render the sentence of performance-tiers.test.js
 * on the 3D FDTD tiers `high`, `ultra` and `studio` with the JavaScript
 * VoiceRenderer (`kernel: 'wasm'`, its hand-written WebAssembly kernel),
 * with the scalar Rust renderer of src/engine/voice-simulator.wasm and with
 * its SIMD build, three runs each, and report the median real-time factors
 * and the SIMD to scalar ratio that decides whether the SIMD file ships
 * (SHIP_SIMD of scripts/build-wasm.mjs: at least 1.15 on `high`).
 * Run with `npm run build:wasm` then
 * `npm run test:heavy -- --suite performance`; HEAVY_LIMIT limits the
 * number of tiers (cheapest first). Skipped with a visible reason when the
 * engine has not been built; REQUIRE_WASM=1 turns that into an error. The
 * SIMD columns stay empty when the runtime rejects the SIMD file.
 */

import { describe, expect, it as alwaysIt } from 'test-anywhere';
import { performance } from 'node:perf_hooks';

import { renderPlan } from '../../src/acoustics/voice.js';
import { RustVoiceRenderer } from '../../src/engine/rust-renderer.js';
import { prepareUtterance } from '../../src/synthesize.js';
import {
  loadRustEngine,
  loadSimdEngine,
  noRust,
} from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const it = itUnless(noRust);
const TEXT = 'The quick brown fox jumps over the dog.';
const RUNS = 3;
const SIMD_SHIP_RATIO = 1.15;
const tiers = ['high', 'ultra', 'studio'].slice(0, heavyLimit(3));
const rows = [];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function renderRust(engine, plan, options) {
  const renderer = new RustVoiceRenderer(engine, plan, options);
  try {
    const samples = new Float32Array(renderer.totalSamples);
    const start = performance.now();
    renderer.render(samples);
    return { samples, seconds: (performance.now() - start) / 1000 };
  } finally {
    renderer.free();
  }
}

function largestDifference(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference = Math.max(
      difference,
      Math.abs(actual[index] - expected[index])
    );
  }
  return difference;
}

/** Three timed runs of JavaScript, Rust scalar and Rust SIMD, interleaved. */
function measure(engines, plan, options) {
  const times = { js: [], scalar: [], simd: [] };
  const difference = { scalar: 0, simd: 0 };
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    const expected = renderPlan(plan, { ...options, kernel: 'wasm' });
    times.js.push((performance.now() - start) / 1000);
    for (const name of ['scalar', 'simd']) {
      if (!engines[name]) {
        continue;
      }
      const actual = renderRust(engines[name], plan, options);
      times[name].push(actual.seconds);
      difference[name] = Math.max(
        difference[name],
        largestDifference(actual.samples, expected)
      );
    }
  }
  return { times, difference };
}

function cell(value, digits = 4) {
  return value === null ? '—' : value.toFixed(digits);
}

describe('performance of the Rust 3D FDTD renderer (issue 23)', () => {
  let simdProblem = null;

  for (const tier of tiers) {
    it(`renders the sentence with tier ${tier} in JavaScript, Rust and Rust SIMD`, async () => {
      const scalar = await loadRustEngine();
      const simd = await loadSimdEngine();
      if (!simd) {
        simdProblem =
          'no SIMD build, or the runtime rejects WebAssembly SIMD; run npm run build:wasm';
      }
      const { plan, renderOptions } = prepareUtterance(TEXT, {
        tier,
        seed: 1,
      });
      const { times, difference } = measure(
        { scalar, simd },
        plan,
        renderOptions
      );
      expect(difference.scalar < 1e-4).toBe(true);
      expect(difference.simd < 1e-4).toBe(true);
      const duration = plan.duration;
      const seconds = {
        js: median(times.js),
        scalar: median(times.scalar),
        simd: simd ? median(times.simd) : null,
      };
      rows.push({
        tier,
        dx: renderOptions.dx,
        sampleRate: renderOptions.sampleRate,
        duration,
        seconds,
        realTimeFactor: {
          js: seconds.js / duration,
          scalar: seconds.scalar / duration,
          simd: simd ? seconds.simd / duration : null,
        },
        scalarSpeedUp: seconds.js / seconds.scalar,
        simdRatio: simd ? seconds.scalar / seconds.simd : null,
        maxAbsDiff: difference,
        runs: times,
      });
    });
  }

  alwaysIt('writes the report', () => {
    if (noRust) {
      globalThis.console.log(`performance-rust-fdtd skipped: ${noRust}`);
      return;
    }
    expect(rows.length).toBe(tiers.length);
    const high = rows.find((row) => row.tier === 'high');
    const ratio = high?.simdRatio ?? null;
    const decision =
      ratio === null
        ? `SIMD not measured (${simdProblem})`
        : `SIMD / scalar on \`high\`: ${ratio.toFixed(3)}×, ${ratio >= SIMD_SHIP_RATIO ? 'at least' : 'below'} ${SIMD_SHIP_RATIO}: ${ratio >= SIMD_SHIP_RATIO ? 'ship' : 'do not ship'} src/engine/voice-simulator-simd.wasm`;
    const markdown = [
      '## Rust 3D FDTD renderer: render time',
      '',
      `Text: "${TEXT}", seed 1, median of ${RUNS} runs, Node.js ${process.version}, ${process.platform} ${process.arch}. Real-time factor (RTF) = render seconds / audio seconds. JavaScript = VoiceRenderer with \`kernel: 'wasm'\`; speed-up = JavaScript RTF / Rust scalar RTF; SIMD ratio = Rust scalar RTF / Rust SIMD RTF.`,
      '',
      '| Tier | dx (cm) | Duration (s) | JavaScript RTF | Rust scalar RTF | Rust SIMD RTF | Speed-up | SIMD ratio | Max abs diff (scalar, SIMD) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.tier} | ${row.dx} | ${row.duration.toFixed(2)} | ${cell(row.realTimeFactor.js)} | ${cell(row.realTimeFactor.scalar)} | ${cell(row.realTimeFactor.simd)} | ${row.scalarSpeedUp.toFixed(2)}× | ${row.simdRatio === null ? '—' : `${row.simdRatio.toFixed(3)}×`} | ${row.maxAbsDiff.scalar}, ${row.maxAbsDiff.simd} |`
      ),
      '',
      decision,
      '',
    ].join('\n');
    writeReport('performance-rust-fdtd', markdown, {
      text: TEXT,
      seed: 1,
      runs: RUNS,
      runtime: `node ${process.version}`,
      platform: `${process.platform}-${process.arch}`,
      simdShipRatio: SIMD_SHIP_RATIO,
      decision,
      tiers: rows,
    });
  });
});
