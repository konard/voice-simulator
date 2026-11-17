/**
 * Truth that the simulator knows about its own output, per analysis frame
 * of the recognizer (issues 59 and 60). Used by
 * tests/recognition-pitch.test.js, tests/recognition-formants.test.js and
 * the issue-59 and issue-60 experiments, and the high-pass filter and
 * speech level of those tests.
 */

import { tubeTransfer } from '../../src/acoustics/transfer.js';
import { sampleState, tractShape } from '../../src/articulation/tract-shape.js';

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

/** Grid step (Hz) and top (Hz) of tubeSpectrum, and the step of the scan
 * in `gridFormants`. */
const FINE_STEP = 5;
const TOP = 5000;
const COARSE_STEP = 50;

/**
 * `tubeFormants(areas, length, {count})` at a tenth of the cost: the
 * transfer on a 50 Hz grid from the bottom up, and from each local maximum
 * (or a rise into 5000 Hz) a climb on the 5 Hz grid of tubeSpectrum to the
 * peak that findPeaks finds there (above the left neighbour, not below the
 * right one, at most 4995 Hz), with its parabolic interpolation; the scan
 * stops at `count` peaks. Formants are wider than 100 Hz, so each coarse
 * maximum holds one fine one: on the planned vowels of
 * experiments/issue-60-truth.mjs it equals tubeFormants on every frame.
 * @param {ArrayLike<number>} areas
 * @param {number} length
 * @param {number} [count]
 * @returns {number[]}
 */
export function gridFormants(areas, length, count = 4) {
  const values = new Map();
  const at = (frequency) => {
    if (!values.has(frequency)) {
      values.set(frequency, tubeTransfer(areas, length, frequency));
    }
    return values.get(frequency);
  };
  const peaks = [];
  for (
    let f = 2 * COARSE_STEP;
    f <= TOP && peaks.length < count;
    f += COARSE_STEP
  ) {
    const last = f + COARSE_STEP > TOP;
    if (at(f) > at(f - COARSE_STEP) && (last || at(f) >= at(f + COARSE_STEP))) {
      const peak = climb(at, f);
      if (peak !== null) {
        peaks.push(peak);
      }
    }
  }
  return peaks;
}

/** Peak of findPeaks on the 5 Hz grid reached from `start`, or null. */
function climb(at, start) {
  let f = start;
  if (at(f + FINE_STEP) > at(f)) {
    while (f + FINE_STEP <= TOP && at(f + FINE_STEP) > at(f)) {
      f += FINE_STEP;
    }
  } else {
    while (at(f - FINE_STEP) >= at(f)) {
      f -= FINE_STEP;
    }
  }
  if (f < 100 || f + FINE_STEP > TOP) {
    return null;
  }
  const left = at(f - FINE_STEP);
  const middle = at(f);
  const right = at(f + FINE_STEP);
  const offset = (0.5 * (left - right)) / (left - 2 * middle + right || 1);
  return f + offset * FINE_STEP;
}

/**
 * Planned formants per frame of `hop` seconds (frame t at time t hop):
 * `tubeFormants(shape.areas, shape.length)` (F1 .. F4, or the first
 * `formants`, by gridFormants) of
 * `shape = tractShape(sampleState(plan, t hop), head)`. `mask` is 1 for
 * frames inside a vowel segment of the plan with a closed velum
 * (`shape.velumArea` 0) and 0 elsewhere; masked-out frames get null.
 * @param {{segments: {kind: string, start: number, end: number}[], frameRate: number, frameCount: number}} plan
 * @param {object} head Head config of the plan (`out.head`).
 * @param {number} hop Seconds.
 * @param {number} [count] Frames; default every frame inside the plan.
 * @param {number} [formants] Formants per frame, default 4.
 * @returns {{formants: (number[]|null)[], mask: Uint8Array}}
 */
export function plannedFormants(plan, head, hop, count, formants = 4) {
  const frames =
    count ?? Math.floor((plan.frameCount - 1) / plan.frameRate / hop) + 1;
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const rows = [];
  const mask = new Uint8Array(frames);
  const state = {};
  for (let t = 0; t < frames; t++) {
    const time = t * hop;
    const inside = vowels.some(
      (segment) => time >= segment.start && time < segment.end
    );
    if (!inside) {
      rows.push(null);
      continue;
    }
    sampleState(plan, time, state);
    const shape = tractShape(state, head);
    if (shape.velumArea > 0) {
      rows.push(null);
      continue;
    }
    rows.push(gridFormants(shape.areas, shape.length, formants));
    mask[t] = 1;
  }
  return { formants: rows, mask };
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
