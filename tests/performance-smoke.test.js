/**
 * A quick speed check on every runtime (issue 31): the cheapest waveguide
 * tiers stay well inside real time, and the Rust engine is not slower than
 * the JavaScript renderer. The heavy check (tests/heavy/performance-tiers)
 * measures every tier against a baseline; this one only catches a change
 * that makes the everyday tiers several times slower, in about a second.
 */

import { describe, expect } from 'test-anywhere';

import { createEngine, synthesize } from '../src/index.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const TEXT = 'Hello world.';
const TIERS = ['telephone', 'minimal'];
// Half of real time leaves room for a busy runner (scripts/performance.mjs).
const REALTIME = 0.5;
// Rust measured about twice as fast as JavaScript on `minimal` (issue 22).
const RUST_SLACK = 1.5;

const rust = noRust ? null : await createEngine({ engine: 'rust' });
const engines = { js: 'js', rust };

/** The fastest RTF of `runs` renders, after one render to warm up. */
function bestRtf(tier, engine, runs) {
  const options = { tier, seed: 1, engine, threads: 1 };
  synthesize(TEXT, options);
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = globalThis.performance.now();
    const result = synthesize(TEXT, options);
    const seconds = (globalThis.performance.now() - start) / 1000;
    best = Math.min(best, seconds / result.duration);
  }
  return best;
}

describe('performance smoke test (issue 31)', () => {
  for (const tier of TIERS) {
    for (const name of Object.keys(engines)) {
      const skip = name === 'rust' ? noRust : null;
      itUnless(skip)(
        `${tier} renders in under half real time on ${name}`,
        () => {
          const rtf = bestRtf(tier, engines[name], 3);
          expect(rtf).toBeLessThan(REALTIME);
        }
      );
    }
  }

  itUnless(noRust)('rust is not slower than js at minimal', () => {
    const js = bestRtf('minimal', 'js', 5);
    const native = bestRtf('minimal', rust, 5);
    expect(native).toBeLessThanOrEqual(js * RUST_SLACK);
  });
});
