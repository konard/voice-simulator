/**
 * Heavy check (issue 31): the real-time factor (RTF) of every audio tier
 * except `reference` on the JavaScript and the Rust engine, on one core,
 * compared with docs/reports/performance-baseline.json by
 * scripts/performance.mjs. Writes performance-tiers.md and
 * performance-tiers.json (schema 1, the input of
 * `node scripts/performance.mjs compare|baseline|trend`).
 *
 * Run with `npm run build:wasm` then
 * `npm run test:heavy -- --suite performance`; HEAVY_LIMIT limits the
 * number of tiers (cheapest first). Without the Rust engine its tests are
 * skipped with a visible reason; REQUIRE_WASM=1 turns that into an error.
 * The speed rules are checked in CI or with PERFORMANCE_COMPARE=1: on a
 * developer machine they say more about what else runs than about the code.
 * With the threads build (`node scripts/build-wasm.mjs --threads`) the 3D
 * tiers are also measured on every core as rows of engine `rust-mt`.
 */

import { describe, it, expect } from 'test-anywhere';
import { existsSync } from 'node:fs';
import { URL } from 'node:url';

import { AUDIO_TIERS, createEngine, synthesize } from '../../src/index.js';
import {
  calibrate,
  comparePerformance,
  comparisonMarkdown,
  createReport,
  FILES,
  machineLine,
  measureRows,
  readReport,
} from '../../scripts/performance.mjs';
import { noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const TEXT = 'The quick brown fox jumps over the dog.';
const BASELINE = new URL(
  `../../docs/reports/${FILES.baseline}`,
  import.meta.url
);
const candidates = AUDIO_TIERS.filter((tier) => tier.name !== 'reference');
const tiers = candidates.slice(0, heavyLimit(candidates.length));
const partial = Boolean(process.env.HEAVY_LIMIT);
const compareHere =
  Boolean(process.env.CI) || process.env.PERFORMANCE_COMPARE === '1';

// Every core, when the threads build loads (issue 24); null otherwise.
const multicore = noRust
  ? null
  : await createEngine({ engine: 'rust', threads: 'auto' });
const threads = multicore?.threads ?? 1;

const calibrations = [calibrate()];
const rows = [];
const unsound = [];
let report = null;
let comparison = null;

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

/** Records every render that is not finite or not between 0.01 and 1. */
function inspect(result, row) {
  const { peak, finite } = peakOf(result.samples);
  if (!finite || peak < 0.01 || peak > 1) {
    unsound.push(`${row.engine} ${row.tier}: peak ${peak}, finite ${finite}`);
  }
}

function measure(tier, engine) {
  rows.push(
    ...measureRows({
      tiers: [tier],
      engines: [engine],
      text: TEXT,
      synthesize,
      inspect,
    })
  );
}

/** Engines that this run measured, so their baseline rows are expected. */
function measuredEngines() {
  return new Set(rows.map((row) => row.engine));
}

describe('performance of the audio tiers (issue 31)', () => {
  for (const tier of tiers) {
    it(`measures tier ${tier.name} on js`, () => measure(tier, 'js'));
    itUnless(noRust)(`measures tier ${tier.name} on rust`, () =>
      measure(tier, 'rust')
    );
    if (tier.solver === 'fdtd3d') {
      itUnless(
        noRust,
        threads > 1 ? null : 'the threads build of the engine is not loaded'
      )(
        `measures tier ${tier.name} on rust-mt${threads > 1 ? ` (${threads} threads)` : ''}`,
        () =>
          measure(tier, { name: 'rust-mt', engine: multicore, threads: 'auto' })
      );
    }
  }

  it('every render is sound', () => {
    expect(rows.length > 0).toBe(true);
    expect(unsound).toEqual([]);
  });

  it('writes the report', () => {
    // Ends the helper threads, which would keep the process alive.
    multicore?.close();
    calibrations.push(calibrate());
    report = createReport({
      text: TEXT,
      calibration: Math.min(...calibrations),
      rows,
    });
    const lines = [
      '## Audio tiers: real-time factor (issue 31)',
      '',
      `Text: "${TEXT}", seed 1, one core (\`threads: 1\`${threads > 1 ? `; \`rust-mt\`: ${threads} threads` : ''}), fastest of 5 runs (waveguide) or 2 (3D). RTF = render seconds / audio seconds.${noRust ? ` Rust: ${noRust}.` : ''}`,
      '',
      machineLine(report),
      '',
    ];
    if (existsSync(BASELINE)) {
      const engines = measuredEngines();
      const baseline = readReport(BASELINE, 'baseline');
      // A runner without an engine (no Rust, or no threads build) is not
      // missing its rows: REQUIRE_WASM and REQUIRE_THREADS_WASM catch a
      // broken build in CI.
      comparison = comparePerformance(
        report,
        {
          ...baseline,
          rows: baseline.rows.filter((row) => engines.has(row.engine)),
        },
        { partial }
      );
      lines.push(comparisonMarkdown(comparison));
    } else {
      lines.push(`No baseline: ${FILES.baseline} does not exist yet.`);
    }
    writeReport('performance-tiers', lines.join('\n'), report);
  });

  itUnless(compareHere ? null : 'baseline comparison runs in CI only')(
    'speed rules hold',
    () => {
      if (!comparison) {
        throw new Error(
          `no baseline to compare with: docs/reports/${FILES.baseline} is missing (node scripts/performance.mjs baseline <report.json>)`
        );
      }
      expect(comparison.failures).toEqual([]);
      expect(comparison.ok).toBe(true);
    }
  );
});
