/** Acoustic decision boundaries and six-vector parity. Unlicense. */
import { describe, expect } from 'test-anywhere';
import {
  classifyWord,
  emotionVector,
  classifyEmotion,
  distance,
} from '../src/recognition/mode-rules.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
const it = itUnless(noRust);
const keys = [
  'alpha',
  'pitch',
  'f1',
  'voiced',
  'h1h2',
  'hnr',
  'cpp',
  'jitter',
  'rate',
  'energyRatio',
  'pitchSpan',
];
const labels = [null, 'W', 'C', 'F', 'V!', 'V̰', 'V͈', 'V̤', 'Ṿ', 'V͉'];
const baseline = {
  alpha: -20,
  pitch: 120,
  f1: null,
  voiced: 1,
  h1h2: 4,
  hnr: 20,
  cpp: 5,
  jitter: 0,
  rate: 4,
  energyRatio: -30,
  pitchSpan: 3,
};
describe('Rust acoustic mode rules', () => {
  it('matches emotion activation, distances, intensity and confidence', async () => {
    const engine = await loadRustEngine();
    const pointer = engine.exports.vs_alloc(24 * 8);
    const vector = [2, 2, 2, 2, 0, 0];
    const refs = [
      { name: 'happy', vector: [2.1, 2, 2, 2, 0, 0] },
      { name: 'sad', vector: [-1, -1, -1, -1, 0, 0] },
    ];
    try {
      float64View(engine, pointer, 18).set([
        ...vector,
        ...refs.flatMap((r) => r.vector),
      ]);
      expect(engine.exports.vs_mode_emotion(pointer, 2, pointer + 18 * 8)).toBe(
        0
      );
      const found = classifyEmotion(vector, refs);
      const wanted = [
        found.emotion.arousal,
        0,
        distance(vector, refs[0].vector),
        distance(vector, refs[1].vector),
        found.emotion.intensity,
        found.confidence,
      ];
      const actual = Array.from(float64View(engine, pointer + 18 * 8, 6));
      expect(actual.every((v, i) => Math.abs(v - wanted[i]) < 1e-10)).toBe(
        true
      );
      expect(engine.exports.vs_mode_emotion(pointer, 13, pointer)).toBe(-6);
    } finally {
      engine.exports.vs_free(pointer, 24 * 8);
    }
  });
  // Exhaustive cross-product of optional F1, baseline availability and rule rows.
  // eslint-disable-next-line complexity
  it('matches word labels, effort/confidence, tempo and phrase vectors', async () => {
    const engine = await loadRustEngine();
    const pointer = engine.exports.vs_alloc(34 * 8);
    try {
      const rows = [
        {},
        { voiced: 0, pitch: 0, energyRatio: -20 },
        { pitch: 40 },
        { pitch: 200, h1h2: 12, cpp: 2 },
        { h1h2: -1, hnr: 8, jitter: 4, cpp: 2 },
        { pitch: 60, jitter: 7 },
        { h1h2: 0 },
        { h1h2: 9, hnr: 10, cpp: 2 },
        { hnr: 8 },
        { h1h2: 9 },
        { alpha: -18, pitch: 170, f1: 35 },
        { rate: 5.2 },
        { rate: 3 },
        { alpha: -22, pitch: 70, f1: -35 },
        { pitch: 95, jitter: 2.2, hnr: 8 },
        { alpha: -24, pitch: 120 },
      ];
      for (const hasF1 of [false, true]) {
        for (const known of [false, true]) {
          for (const row of rows) {
            const word = {
              ...baseline,
              ...row,
              f1: hasF1 ? (row.f1 ?? 0) : null,
            };
            const expected = classifyWord(word, baseline, known);
            const quality = expected.quality;
            const id =
              quality?.effort !== undefined
                ? 10
                : labels.indexOf(
                    quality?.notation?.replace(/^[123]/u, '') ?? null
                  );
            const value =
              quality?.effort ??
              Object.values(quality?.phonation ?? {})[0] ??
              0;
            const packet = [
              ...keys.map((k) => word[k] ?? 0),
              ...keys.map((k) => baseline[k] ?? 0),
            ];
            float64View(engine, pointer, 22).set(packet);
            expect(
              engine.exports.vs_mode_rules(
                pointer,
                +hasF1,
                +known,
                pointer + 22 * 8
              )
            ).toBe(0);
            const actual = Array.from(
              float64View(engine, pointer + 22 * 8, 12)
            );
            const wanted = [
              expected.E,
              expected.effort,
              expected.confidence,
              id,
              value,
              expected.tempo?.rate ?? 0,
              ...emotionVector(word, baseline),
            ];
            expect(
              actual.every((v, i) => Math.abs(v - wanted[i]) < 1e-10)
            ).toBe(true);
          }
        }
      }
      expect(engine.exports.vs_mode_rules(pointer, 2, 1, pointer)).toBe(-6);
      expect(engine.exports.vs_mode_rules(1, 0, 0, pointer)).toBe(-2);
    } finally {
      engine.exports.vs_free(pointer, 34 * 8);
    }
  });
});
