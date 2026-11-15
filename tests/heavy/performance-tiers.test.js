/**
 * Heavy check: render one sentence with every audio tier except
 * `reference` and report the wall time and the real-time factor.
 * Run with `npm run test:heavy -- --suite performance`; HEAVY_LIMIT limits
 * the number of tiers (cheapest first).
 */

import { describe, it, expect } from 'test-anywhere';
import { performance } from 'node:perf_hooks';
import { AUDIO_TIERS, synthesize } from '../../src/index.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const TEXT = 'The quick brown fox jumps over the dog.';
const tiers = AUDIO_TIERS.filter((tier) => tier.name !== 'reference').slice(
  0,
  heavyLimit(6)
);
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

describe('performance of the audio tiers', () => {
  for (const tier of tiers) {
    it(`renders the sentence with tier ${tier.name}`, () => {
      const start = performance.now();
      const result = synthesize(TEXT, { tier: tier.name, seed: 1 });
      const seconds = (performance.now() - start) / 1000;
      const { peak, finite } = peakOf(result.samples);

      expect(finite).toBe(true);
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThanOrEqual(1);

      rows.push({
        tier: tier.name,
        solver: tier.solver,
        sampleRate: result.sampleRate,
        duration: result.duration,
        seconds,
        realTimeFactor: seconds / result.duration,
        peak,
      });
    });
  }

  it('writes the report', () => {
    expect(rows.length).toBe(tiers.length);
    const markdown = [
      '## Audio tiers: render time',
      '',
      `Text: "${TEXT}", seed 1, Node.js ${process.version}, ${process.platform} ${process.arch}. Real-time factor = render seconds / audio seconds (below 1 is faster than real time).`,
      '',
      '| Tier | Sample rate (Hz) | Duration (s) | Seconds | Real-time factor |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.tier} | ${row.sampleRate} | ${row.duration.toFixed(2)} | ${row.seconds.toFixed(2)} | ${row.realTimeFactor.toFixed(2)} |`
      ),
      '',
    ].join('\n');
    writeReport('performance-tiers', markdown, {
      text: TEXT,
      seed: 1,
      runtime: `node ${process.version}`,
      platform: `${process.platform}-${process.arch}`,
      tiers: rows,
    });
  });
});
