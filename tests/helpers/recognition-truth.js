/**
 * Truth that the simulator knows about its own output, per analysis frame
 * of the recognizer (issue 59). Used by tests/recognition-pitch.test.js and
 * the issue-59 experiments, and the high-pass filter and speech level of
 * those tests.
 */

import { sampleState } from '../../src/articulation/tract-shape.js';

/** Frames closer than this (s) to a change of voicing are not scored. */
export const VOICING_GUARD = 0.015;

/**
 * Planned f0 per frame of `hop` seconds (frame t at time t hop): f0 from
 * `sampleState(plan, t hop)`, 0 where `voicing < 0.5` or `loudness < 0.05`.
 * `mask` is 0 for frames within 15 ms of a voiced/unvoiced change (the
 * change sits half way between two frames) and 1 elsewhere.
 * @param {{channels: Record<string, Float32Array>, frameRate: number, frameCount: number}} plan
 * @param {number} hop Seconds.
 * @param {number} [count] Frames; default every frame inside the plan.
 * @returns {{f0: Float64Array, mask: Uint8Array}}
 */
export function plannedPitch(plan, hop, count) {
  const frames =
    count ?? Math.floor((plan.frameCount - 1) / plan.frameRate / hop) + 1;
  const f0 = new Float64Array(frames);
  const state = {};
  for (let t = 0; t < frames; t++) {
    sampleState(plan, t * hop, state);
    f0[t] = state.voicing < 0.5 || state.loudness < 0.05 ? 0 : state.f0;
  }
  const mask = new Uint8Array(frames).fill(1);
  const reach = Math.floor(VOICING_GUARD / hop + 0.5 + 1e-9);
  for (let t = 0; t + 1 < frames; t++) {
    if (f0[t] > 0 !== f0[t + 1] > 0) {
      // Change at (t + 0.5) hop: frames within VOICING_GUARD of it.
      for (let k = t + 1 - reach; k <= t + reach; k++) {
        if (k >= 0 && k < frames) {
          mask[k] = 0;
        }
      }
    }
  }
  return { f0, mask };
}

/**
 * The frames of `reference` and `test` where `mask` is 1, as two arrays for
 * `f0Errors`.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @param {ArrayLike<number>} mask
 */
export function maskedPair(reference, test, mask) {
  const r = [];
  const t = [];
  const frames = Math.min(reference.length, test.length, mask.length);
  for (let index = 0; index < frames; index++) {
    if (mask[index]) {
      r.push(reference[index]);
      t.push(test[index]);
    }
  }
  return [r, t];
}

/**
 * `samples` through `order / 2` Butterworth high-pass sections (bilinear
 * transform) at `cutoff` Hz; `order` is even.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} cutoff
 * @param {number} [order]
 */
export function highPass(samples, sampleRate, cutoff, order = 8) {
  let x = Float64Array.from(samples);
  const k = Math.tan((Math.PI * cutoff) / sampleRate);
  for (let section = 0; section < order / 2; section++) {
    const q = 1 / (2 * Math.sin((Math.PI * (2 * section + 1)) / (2 * order)));
    const norm = 1 / (1 + k / q + k * k);
    const b0 = norm;
    const a1 = 2 * (k * k - 1) * norm;
    const a2 = (1 - k / q + k * k) * norm;
    const y = new Float64Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let n = 0; n < x.length; n++) {
      y[n] = b0 * (x[n] - 2 * x1 + x2) - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[n];
      y2 = y1;
      y1 = y[n];
    }
    x = y;
  }
  return Float32Array.from(x);
}

/**
 * Mean square of `samples` over the 25 ms frames (hop `hop`) where `f0` is
 * above 0: the speech level that noise is measured against.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {ArrayLike<number>} f0 Planned f0 per frame.
 * @param {number} hop
 */
export function speechLevel(samples, sampleRate, f0, hop) {
  const half = Math.round(0.0125 * sampleRate);
  let power = 0;
  let count = 0;
  for (let t = 0; t < f0.length; t++) {
    if (f0[t] > 0) {
      const centre = Math.round(t * hop * sampleRate);
      for (let n = centre - half; n < centre + half; n++) {
        if (n >= 0 && n < samples.length) {
          power += samples[n] * samples[n];
          count++;
        }
      }
    }
  }
  return count > 0 ? power / count : 0;
}
