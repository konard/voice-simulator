/** Numerical parity of copy controls in JavaScript and native Rust. Unlicense. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { itUnless } from './helpers/skip.js';
import {
  loudnessGain,
  pitchContour,
  rmsTrack,
} from '../src/session/copy-prosody.js';
import {
  blendControl,
  offsetControl,
  offsetPenalty,
} from '../src/session/copy-refinement.js';
import {
  phoneDuration,
  sampleTrack,
  sourceFrame,
} from '../src/session/warp.js';

const native = process.env.COPY_NATIVE_PROBE;

itUnless(
  !native && 'set COPY_NATIVE_PROBE to the copy_controls example executable'
)('matches native copy controls', () => {
  const f0 = Float32Array.from({ length: 72 }, (_, i) => {
    if (i < 5 || (i >= 60 && i <= 62)) {
      return 0;
    }
    if (i >= 23 && i <= 27) {
      return 240 + i * 0.5;
    }
    return i === 49 ? 800 : 120 + i * 0.25;
  });
  const audio = Float32Array.from(
    { length: 640 },
    (_, i) => ((i % 31) - 15) / 128
  );
  const { values, threshold } = rmsTrack(audio, 16000, 11, 200);
  // Rust prints shortest decimal representations of f32; round back before comparing.
  const [nativePitch, nativeLevels, nativeControls] = execFileSync(native, {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.replaceAll('-inf', 'null')));
  assert.deepEqual(Float32Array.from(nativePitch), pitchContour(f0, 200, 130));
  const near = (actual, expected) =>
    assert.ok(
      Math.abs(actual - expected) < 1e-10,
      `${actual} differs from ${expected}`
    );
  values.forEach((value, i) => {
    if (Number.isFinite(value)) {
      near(nativeLevels[i], value);
    } else {
      assert.equal(nativeLevels[i], null);
    }
  });
  const span = { start: 0.1, end: 0.2, sourceStart: 0.2, sourceEnd: 0.3 };
  const expected = [
    threshold,
    loudnessGain(-22, -42),
    loudnessGain(-42, -22),
    loudnessGain(-28, -32),
    phoneDuration(0.1, 0.025, 0.003, true),
    phoneDuration(0.1, 0.05, 0.003, true),
    phoneDuration(0.1, 0.025, 0.6, true),
    phoneDuration(0.1, 0.025, 0.6, false),
    sourceFrame(0.161, span, 200),
    sampleTrack(new Float32Array([1, 2, 3]), 1.25),
    Math.fround(blendControl(0.375, 0.614, 0.5)),
    Math.fround(offsetControl(0.375, -0.05, 4, 10)),
    offsetPenalty(0.1, 0.05),
  ];
  expected.forEach((value, i) => near(nativeControls[i], value));
});
