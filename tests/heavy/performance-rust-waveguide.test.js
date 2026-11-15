/**
 * Heavy check (issue 22): render the sentence of performance-tiers.test.js
 * on every waveguide tier with the JavaScript VoiceRenderer and with the
 * Rust renderer of src/engine/voice-simulator.wasm, three runs each, and
 * report the median real-time factors, their ratio and the share of the
 * Rust render spent preparing frames in JavaScript.
 * Run with `npm run build:wasm` then
 * `npm run test:heavy -- --suite performance`; HEAVY_LIMIT limits the
 * number of tiers (cheapest first). Skipped with a visible reason when the
 * engine has not been built; REQUIRE_WASM=1 turns that into an error.
 */

import { describe, expect, it as alwaysIt } from 'test-anywhere';
import { performance } from 'node:perf_hooks';

import { AUDIO_TIERS } from '../../src/index.js';
import { renderPlan } from '../../src/acoustics/voice.js';
import { RustVoiceRenderer } from '../../src/engine/rust-renderer.js';
import { prepareUtterance } from '../../src/synthesize.js';
import { loadRustEngine, noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const it = itUnless(noRust);
const TEXT = 'The quick brown fox jumps over the dog.';
const RUNS = 3;
const tiers = AUDIO_TIERS.filter((tier) => tier.solver === 'waveguide').slice(
  0,
  heavyLimit(6)
);
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
    const total = performance.now() - start;
    return { samples, seconds: total / 1000, prepare: renderer.prepareTime };
  } finally {
    renderer.free();
  }
}

describe('performance of the Rust waveguide renderer (issue 22)', () => {
  for (const tier of tiers) {
    it(`renders the sentence with tier ${tier.name} in JavaScript and Rust`, async () => {
      const engine = await loadRustEngine();
      const { plan, renderOptions } = prepareUtterance(TEXT, {
        tier: tier.name,
        seed: 1,
      });
      const js = [];
      const rust = [];
      const shares = [];
      let difference = 0;
      for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        const expected = renderPlan(plan, renderOptions);
        js.push((performance.now() - start) / 1000);
        const actual = renderRust(engine, plan, renderOptions);
        rust.push(actual.seconds);
        shares.push(actual.prepare / 1000 / actual.seconds);
        expect(actual.samples.length).toBe(expected.length);
        for (let index = 0; index < expected.length; index++) {
          difference = Math.max(
            difference,
            Math.abs(actual.samples[index] - expected[index])
          );
        }
      }
      expect(difference < 1e-4).toBe(true);
      const duration = plan.duration;
      const jsSeconds = median(js);
      const rustSeconds = median(rust);
      rows.push({
        tier: tier.name,
        sampleRate: renderOptions.sampleRate,
        duration,
        jsSeconds,
        rustSeconds,
        jsRealTimeFactor: jsSeconds / duration,
        rustRealTimeFactor: rustSeconds / duration,
        speedUp: jsSeconds / rustSeconds,
        prepareShare: median(shares),
        maxAbsDiff: difference,
        runs: { js, rust },
      });
    });
  }

  alwaysIt('writes the report', () => {
    if (noRust) {
      globalThis.console.log(`performance-rust-waveguide skipped: ${noRust}`);
      return;
    }
    expect(rows.length).toBe(tiers.length);
    const markdown = [
      '## Rust waveguide renderer: render time',
      '',
      `Text: "${TEXT}", seed 1, median of ${RUNS} runs, Node.js ${process.version}, ${process.platform} ${process.arch}. Real-time factor (RTF) = render seconds / audio seconds; speed-up = JavaScript RTF / Rust RTF; frame preparation = share of the Rust render spent preparing frames in JavaScript.`,
      '',
      '| Tier | Sample rate (Hz) | Duration (s) | JavaScript RTF | Rust RTF | Speed-up | Frame preparation | Max abs diff |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.tier} | ${row.sampleRate} | ${row.duration.toFixed(2)} | ${row.jsRealTimeFactor.toFixed(4)} | ${row.rustRealTimeFactor.toFixed(4)} | ${row.speedUp.toFixed(2)}× | ${(100 * row.prepareShare).toFixed(1)}% | ${row.maxAbsDiff} |`
      ),
      '',
    ].join('\n');
    writeReport('performance-rust-waveguide', markdown, {
      text: TEXT,
      seed: 1,
      runs: RUNS,
      runtime: `node ${process.version}`,
      platform: `${process.platform}-${process.arch}`,
      tiers: rows,
    });
  });
});
