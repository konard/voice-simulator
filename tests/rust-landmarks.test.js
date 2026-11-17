/** Class B numerical parity of the complete landmark detector. The Rust
 * stage reads the same frame set, not separately recomputed spectra. */
import { describe, expect } from 'test-anywhere';
import {
  analyzeFrames,
  findLandmarks,
  presetHeadConfig,
  synthesize,
} from '../src/index.js';
import { LANDMARK_THRESHOLDS } from '../src/recognition/landmark-thresholds.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import { boundaryFrames } from './helpers/landmark-frames.js';
const it = itUnless(noRust);
const KEYS = [
  'silence',
  'voiced',
  'fricativeZcr',
  'fricativeGravity',
  'nasalDrop',
  'nasalBelowPeak',
  'glideBelowPeak',
  'nucleusAboveNoise',
  'nucleusDip',
  'landmarkRise',
];
const TYPES = ['b+', 'b-', 'g+', 'g-', 's+', 's-'];
function packedFrames(frames) {
  const rows = new Float64Array(frames.count * (13 + frames.melBands));
  for (let t = 0; t < frames.count; t++) {
    const row = t * (13 + frames.melBands);
    for (const [k, key] of [
      'energy',
      'noise',
      'speech',
      'periodicity',
      'zcr',
      'gravity',
      'tilt',
    ].entries()) {
      rows[row + k] = frames[key][t];
    }
    rows.set(frames.band.subarray(t * 6, t * 6 + 6), row + 7);
    rows.set(
      frames.mel.subarray(t * frames.melBands, (t + 1) * frames.melBands),
      row + 13
    );
  }
  return rows;
}
async function rustResult(frames) {
  const engine = await loadRustEngine();
  const rows = packedFrames(frames);
  const sizes = [rows.byteLength, 80, frames.count * 12 * 8];
  const pointers = sizes.map((n) => engine.exports.vs_alloc(Math.max(8, n)));
  try {
    float64View(engine, pointers[0], rows.length).set(rows);
    float64View(engine, pointers[1], 10).set(
      KEYS.map((key) => LANDMARK_THRESHOLDS[key])
    );
    expect(
      engine.exports.vs_landmarks(
        pointers[0],
        frames.count,
        frames.melBands,
        frames.rate,
        frames.hop,
        pointers[1],
        pointers[2]
      )
    ).toBe(0);
    return float64View(engine, pointers[2], frames.count * 12).slice();
  } finally {
    for (let i = 0; i < 3; i++) {
      engine.exports.vs_free(pointers[i], Math.max(8, sizes[i]));
    }
  }
}
function packedExpected(result) {
  const rows = new Float64Array(result.count * 12);
  for (let t = 0; t < result.count; t++) {
    rows[t * 12] = result.classes[t];
    rows[t * 12 + 1] = result.sonority[t];
  }
  for (const nucleus of result.nuclei) {
    const row = Math.round((nucleus.time - result.startTime) / result.hop) * 12;
    rows[row + 2] = 1;
    rows[row + 3] = (nucleus.start - result.startTime) / result.hop;
    rows[row + 4] =
      nucleus.end === null ? -1 : (nucleus.end - result.startTime) / result.hop;
    rows[row + 5] = nucleus.strength;
  }
  for (const landmark of result.landmarks) {
    rows[
      Math.round((landmark.time - result.startTime) / result.hop) * 12 +
        6 +
        TYPES.indexOf(landmark.type)
    ] = landmark.strength;
  }
  return rows;
}
describe('Rust landmark parity', () => {
  it('matches strengths after a deeper boundary replaces an early minimum', async () => {
    for (const trailingSilence of [false, true]) {
      const frames = boundaryFrames(trailingSilence);
      const expected = packedExpected(findLandmarks(frames));
      const actual = await rustResult(frames);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(actual[i] - expected[i]) <= 1e-6).toBe(true);
      }
    }
  });
  it('matches the JavaScript sonority, classes, nuclei and landmarks', async () => {
    for (const rate of [8000, 11025, 16000]) {
      for (const preset of ['male', 'female']) {
        for (const hop of [0.005, 0.01]) {
          const out = synthesize('apa asa ama aba', {
            ipa: true,
            head: presetHeadConfig(preset),
            solver: 'waveguide',
            engine: 'js',
            sampleRate: rate,
            seed: 1,
          });
          const frames = analyzeFrames(out.samples, rate, { hop });
          const expected = packedExpected(findLandmarks(frames));
          const actual = await rustResult(frames);
          let error = 0,
            power = 0;
          for (let i = 0; i < expected.length; i++) {
            error += (actual[i] - expected[i]) ** 2;
            power += expected[i] ** 2;
            if (i % 12 === 0 || i % 12 === 2) {
              expect(actual[i]).toBe(expected[i]);
            }
          }
          console.log(
            `landmarks Rust ${preset}@${rate}/${hop}: relative RMS ${Math.sqrt(error / power)}`
          );
          expect(Math.sqrt(error / power) <= 1e-6).toBe(true);
        }
      }
    }
  });
});
