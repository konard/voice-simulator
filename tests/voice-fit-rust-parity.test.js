/** Voice-fitting numerical parity, class B, issue 63. Unlicense. */
import { describe, expect } from 'test-anywhere';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import { float64View } from '../src/engine/wasm-loader.js';
import {
  emptyState,
  addValue,
  quantile,
  medianSd,
  HISTOGRAMS,
} from '../src/analysis/voice-fit-statistics.js';
import { simplex } from '../src/analysis/voice-fit-simplex.js';
import { featureVector, vectorDistance } from '../src/analysis/voice-fit.js';
const it = itUnless(noRust);
const near = (a, b) =>
  expect(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))).toBe(true);
describe('Rust voice fitting primitives', () => {
  it('matches fixed histograms, MAD uncertainty and weighted distances', async () => {
    const engine = await loadRustEngine(),
      e = engine.exports;
    const state = emptyState();
    for (let i = 0; i < 200; i++) {
      addValue(state, 'f0', 100 + i / 4);
      addValue(state, 'dF', 800 + (i % 31) * 5);
    }
    const pointer = e.vs_alloc(4096 * 8),
      out = e.vs_alloc(16);
    try {
      for (const key of ['f0', 'dF']) {
        const bins = state.histograms[key];
        float64View(engine, pointer, bins.length).set(bins);
        const [min, , step] = HISTOGRAMS[key];
        for (const p of [0, 0.05, 0.5, 0.95, 1]) {
          expect(
            e.vs_voice_fit_histogram(
              pointer,
              bins.length,
              min,
              step,
              key === 'f0' ? 1 : 0,
              p,
              out
            )
          ).toBe(0);
          const values = float64View(engine, out, 2);
          near(values[0], quantile(state, key, p));
          near(values[1], medianSd(state, key));
        }
      }
      const a = {
          values: Array.from({ length: 36 }, (_, i) =>
            i === 3 ? null : i / 4
          ),
          scales: Array(36).fill(3),
        },
        b = {
          values: a.values.map((x, i) => (x === null ? null : x + i / 10)),
          scales: a.scales,
        };
      float64View(engine, pointer, 108).set([
        ...a.values.map((x) => x ?? NaN),
        ...b.values.map((x) => x ?? NaN),
        ...a.scales,
      ]);
      for (const transcript of [false, true]) {
        near(
          e.vs_voice_fit_distance(pointer, 36, Number(transcript), 2),
          vectorDistance(a, b, transcript, 2)
        );
      }
      state.voicedFrames = 2;
      state.mel[0] = 2 * Math.log(100);
      float64View(engine, pointer, 24).set(state.mel);
      // In-place conversion also verifies the export does not alias its input.
      expect(e.vs_voice_fit_mel(pointer, 2, pointer)).toBe(0);
      const mel = float64View(engine, pointer, 24);
      featureVector(state)
        .values.slice(12)
        .forEach((x, i) => near(mel[i], x));
      expect(e.vs_voice_fit_histogram(0, 1, 0, 1, 0, 0.5, out) < 0).toBe(true);
    } finally {
      e.vs_free(pointer, 4096 * 8);
      e.vs_free(out, 16);
    }
  });
  it('takes the same bounded simplex path', async () => {
    const engine = await loadRustEngine(),
      e = engine.exports,
      pointer = e.vs_alloc(32),
      out = e.vs_alloc(72);
    try {
      for (const [initial, target] of [
        [
          [0.9, 0.1],
          [0.2, 0.7],
        ],
        [[0.2], [0.32]],
      ]) {
        const n = initial.length;
        float64View(engine, pointer, 2 * n).set([...initial, ...target]);
        const cost = (x) => ({
          cost: x.reduce(
            (sum, v, i) => sum + 100 * (v - target[i]) * (v - target[i]),
            0
          ),
        });
        for (const budget of [0, 1, 2, 3, 4, 10, 80]) {
          const search = simplex(initial, cost, budget);
          let next = search.next();
          while (!next.done) {
            next = search.next();
          }
          const count = e.vs_voice_fit_simplex(pointer, n, budget, out);
          expect(count).toBe(next.value.length);
          const values = float64View(engine, out, (n + 1) ** 2);
          next.value.forEach((v, i) => {
            near(values[i * (n + 1)], v.cost);
            v.x.forEach((x, j) => near(values[i * (n + 1) + j + 1], x));
          });
        }
      }
    } finally {
      e.vs_free(pointer, 32);
      e.vs_free(out, 72);
    }
  });
});
