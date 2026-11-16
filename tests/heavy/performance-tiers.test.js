/**
 * Heavy check: render one sentence with every audio tier except
 * `reference`, with the JavaScript engine and, when
 * src/engine/voice-simulator.wasm exists, with the Rust engine, and report
 * the wall time and the real-time factor of each.
 * Run with `npm run test:heavy -- --suite performance`; HEAVY_LIMIT limits
 * the number of tiers (cheapest first). Times are reported, not asserted:
 * a shared machine makes a timing assertion flaky.
 */

import { describe, it, expect } from 'test-anywhere';
import { performance } from 'node:perf_hooks';
import { AUDIO_TIERS, createEngine, synthesize } from '../../src/index.js';
import { noRust } from '../helpers/rust-engine.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const TEXT = 'The quick brown fox jumps over the dog.';
const tiers = AUDIO_TIERS.filter((tier) => tier.name !== 'reference').slice(
  0,
  heavyLimit(6)
);
const engines = {
  js: await createEngine({ engine: 'js' }),
  rust: noRust ? null : await createEngine({ engine: 'rust' }),
};
const rows = [];

function peakOf(samples) {
  let peak = 0;
  let finite = true;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      finite = false;
    }
    peak = Math.max(peak, Math.abs(sample));
  }
  return { peak, finite };
}

/** Render the sentence and check the samples; the time in seconds. */
function measure(tier, engine) {
  const start = performance.now();
  const result = synthesize(TEXT, { tier: tier.name, seed: 1, engine });
  const seconds = (performance.now() - start) / 1000;
  const { peak, finite } = peakOf(result.samples);

  expect(finite).toBe(true);
  expect(peak).toBeGreaterThan(0.01);
  expect(peak).toBeLessThanOrEqual(1);
  return { result, seconds, peak };
}

/** The engine that renders `tier` when `engine` is asked to. */
function renderedBy(engine, tier) {
  const reason = engine.supports({
    solver: tier.solver,
    sections: tier.sections,
    dx: tier.dx,
    sampleRate: tier.sampleRate,
    blockSize: tier.blockSize,
    bandLimit: tier.bandLimit,
  });
  return reason === null ? engine.name : `js (${reason})`;
}

function fixed(value, digits) {
  return value === null ? '-' : value.toFixed(digits);
}

describe('performance of the audio tiers', () => {
  for (const tier of tiers) {
    it(`renders the sentence with tier ${tier.name}`, () => {
      const js = measure(tier, engines.js);
      const rust = engines.rust ? measure(tier, engines.rust) : null;
      const { duration, sampleRate } = js.result;

      rows.push({
        tier: tier.name,
        solver: tier.solver,
        sampleRate,
        duration,
        seconds: js.seconds,
        realTimeFactor: js.seconds / duration,
        peak: js.peak,
        rust: rust && {
          engine: renderedBy(engines.rust, tier),
          seconds: rust.seconds,
          realTimeFactor: rust.seconds / rust.result.duration,
          speedup: js.seconds / rust.seconds,
          peak: rust.peak,
        },
      });
    });
  }

  it('writes the report', () => {
    expect(rows.length).toBe(tiers.length);
    const markdown = [
      '## Audio tiers: render time',
      '',
      `Text: "${TEXT}", seed 1, Node.js ${process.version}, ${process.platform} ${process.arch}. Real-time factor = render seconds / audio seconds (below 1 is faster than real time). Speed-up = JavaScript seconds / Rust seconds.${noRust ? ` Rust: ${noRust}.` : ''}`,
      '',
      '| Tier | Sample rate (Hz) | Duration (s) | JS seconds | JS real-time factor | Rust seconds | Rust real-time factor | Speed-up | Rendered by |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.tier} | ${row.sampleRate} | ${row.duration.toFixed(2)} | ${row.seconds.toFixed(2)} | ${row.realTimeFactor.toFixed(2)} | ${fixed(row.rust?.seconds ?? null, 2)} | ${fixed(row.rust?.realTimeFactor ?? null, 2)} | ${fixed(row.rust?.speedup ?? null, 2)} | ${row.rust?.engine ?? '-'} |`
      ),
      '',
    ].join('\n');
    writeReport('performance-tiers', markdown, {
      text: TEXT,
      seed: 1,
      runtime: `node ${process.version}`,
      platform: `${process.platform}-${process.arch}`,
      rust: noRust ?? 'present',
      tiers: rows,
    });
  });
});
