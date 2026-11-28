/** Syllable nuclei of the voice fitter state (findLandmarks, #62). Unlicense,
 * issue 63. The frontend's noise floor remembers 1.5 s of minima, so a
 * stretch analysed alone finds other nuclei near its start than the whole
 * recording. Each update therefore prepends the last CARRY seconds of sound
 * (16-bit samples in the state; bounded, it does not grow with the sound),
 * commits the nuclei up to HOLD seconds before its end and keeps the rest as
 * pending until the next stretch confirms them. One update of a whole
 * recording counts exactly findLandmarks(analyzeFrames(samples)).nuclei.
 * Reproduce the choice with experiments/issue-63/landmark-carry.mjs. */
import { analyzeFrames } from '../recognition/frontend.js';
import { findLandmarks } from '../recognition/landmarks.js';

export const NUCLEI_CARRY = 2;
export const NUCLEI_HOLD = 0.3;
const FULL = 32767;

export function emptyNuclei() {
  return { sampleRate: 0, pending: 0, carry: [] };
}

export function validNuclei(n) {
  return (
    Number.isFinite(n?.sampleRate) &&
    n.sampleRate >= 0 &&
    Number.isInteger(n.pending) &&
    n.pending >= 0 &&
    Array.isArray(n.carry) &&
    n.carry.length <= Math.ceil(NUCLEI_CARRY * n.sampleRate) &&
    n.carry.every((v) => Number.isInteger(v) && Math.abs(v) <= FULL + 1)
  );
}

/** Adds the nuclei of `input` to `state` and returns the committed count.
 * `frames` is analyzeFrames(input) with `options`, reused without a carry. */
export function countNuclei(state, input, sampleRate, frames, options = {}) {
  const previous =
    state.landmarks?.sampleRate === sampleRate ? state.landmarks.carry : [];
  let combined = input,
    analysed = frames;
  if (previous.length) {
    combined = new Float32Array(previous.length + input.length);
    for (let i = 0; i < previous.length; i++) {
      combined[i] = previous[i] / FULL;
    }
    combined.set(input, previous.length);
    analysed = analyzeFrames(combined, sampleRate, {
      ...options,
      hop: options.hop ?? frames.hop,
      maxSeconds: combined.length / sampleRate + 1,
    });
  }
  const from = previous.length ? previous.length / sampleRate - NUCLEI_HOLD : 0;
  const end = combined.length / sampleRate - NUCLEI_HOLD;
  let committed = 0,
    pending = 0;
  for (const { time } of findLandmarks(analysed).nuclei) {
    if (time >= from) {
      if (time < end) {
        committed++;
      } else {
        pending++;
      }
    }
  }
  const keep = combined.subarray(
    Math.max(0, combined.length - Math.round(NUCLEI_CARRY * sampleRate))
  );
  state.nuclei += committed;
  state.landmarks = {
    sampleRate,
    pending,
    carry: Array.from(keep, (v) =>
      Math.round(Math.max(-1, Math.min(1, v)) * FULL)
    ),
  };
  return committed;
}

/** Committed and pending nuclei of a state. */
export function totalNuclei(state) {
  return state.nuclei + (state.landmarks?.pending ?? 0);
}
