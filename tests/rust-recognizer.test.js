/** Numerical parity for public recognition policy. Unlicense. */
import assert from 'node:assert/strict';
import { RECOGNITION_LEVELS } from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { noisyFrames } from '../src/recognition/recognizer.js';
import { adaptiveLevel } from '../src/recognition/recognizer-stream.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

itUnless(noRust)(
  'matches Rust recognition levels, load decisions and noise gates',
  async () => {
    const engine = await loadRustEngine();
    const { vs_alloc, vs_free, vs_recognizer_policy } = engine.exports;
    const size = 20;
    const source = vs_alloc(size * 8);
    const output = vs_alloc(5 * 8);
    try {
      const cases = [
        {
          level: 0,
          recent: 0.8,
          sustained: 0.299,
          seconds: 2,
          energy: () => -100,
        },
        {
          level: 1,
          recent: 0.801,
          sustained: 0.1,
          seconds: 2,
          energy: (i) => -38 + i / 10,
        },
        {
          level: 2,
          recent: NaN,
          sustained: NaN,
          seconds: 2,
          energy: (i) => -60 + 2 * i,
        },
        {
          level: 2,
          recent: 0.5,
          sustained: 0.1,
          seconds: 1,
          energy: () => -22,
        },
        {
          level: 1,
          recent: 0.8,
          sustained: 0.3,
          seconds: 2,
          energy: (i) => (i < 10 ? -25 : -20),
        },
      ];
      const levels = Object.values(RECOGNITION_LEVELS);
      for (const { level, recent, sustained, seconds, energy } of cases) {
        const values = Float64Array.from({ length: size }, (_, i) => energy(i));
        float64View(engine, source, size).set(values);
        assert.equal(
          vs_recognizer_policy(
            source,
            size,
            seconds,
            level,
            recent,
            sustained,
            output
          ),
          0
        );
        const { rate, hop, beam } = levels[level];
        assert.deepEqual(Array.from(float64View(engine, output, 5)), [
          rate,
          hop,
          beam,
          adaptiveLevel(level, recent, sustained),
          Number(noisyFrames(values, size, seconds)),
        ]);
      }
    } finally {
      vs_free(output, 5 * 8);
      vs_free(source, size * 8);
    }
  }
);
