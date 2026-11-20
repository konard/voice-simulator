/** Numerical voice session parity between JS and WASM. Unlicense. */
import { describe, expect } from 'test-anywhere';
import { float64View } from '../src/engine/wasm-loader.js';
import {
  jackknifeError,
  normalizedChange,
  quantile,
  retainedWeight,
  vowelPitch,
} from '../src/session/numerics.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);
const near = (actual, expected) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9);

describe('Rust voice session', () => {
  it('matches percentile pitch, decay, normalized changes and jackknife errors', async () => {
    const engine = await loadRustEngine();
    const e = engine.exports;
    const values = Array.from({ length: 135 }, (_, i) =>
      i % 9 === 8 ? 242 : 117 + i / 16
    );
    const input = e.vs_alloc(values.length * 8);
    const out = e.vs_alloc(3 * 8);
    try {
      float64View(engine, input, values.length).set(values);
      expect(e.vs_voice_session_pitch(input, values.length, out)).toBe(0);
      const [median, pitch, range] = float64View(engine, out, 3);
      const expected = vowelPitch(values);
      near(median, quantile(values));
      near(pitch, expected.pitch);
      near(range, expected.pitchRange);
      const folds = [116.8, 117.1, 118.4, 120.5];
      near(e.vs_voice_session_jackknife(...folds), jackknifeError(folds));
      near(
        e.vs_voice_session_change(0, 0.11, 0, 1),
        normalizedChange(0, 0.11, 0, 1)
      );
      near(e.vs_voice_session_retain(60, 30), retainedWeight(60, 30));
      expect(e.vs_voice_session_pitch(input, 8193, out)).toBeLessThan(0);
    } finally {
      e.vs_free(input, values.length * 8);
      e.vs_free(out, 3 * 8);
    }
  });
});
