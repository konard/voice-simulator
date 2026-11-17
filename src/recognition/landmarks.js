/** Syllable nuclei and acoustic landmarks (Mermelstein 1975, Liu 1996,
 * de Jong and Wempe 2009). Reads only the analysis frame set. */
import { createNucleusScanner } from './landmark-nuclei.js';
import { LANDMARK_THRESHOLDS } from './landmark-thresholds.js';
import {
  BROAD_CLASSES,
  sonorityFilters,
  fillSonority,
  smoothSonority,
  landmarkCandidates,
  classifyFrame,
  cleanClasses,
} from './landmark-signals.js';
export { BROAD_CLASSES };

function thresholds(options) {
  const T = { ...LANDMARK_THRESHOLDS, ...options.thresholds };
  for (const [name, value] of Object.entries(T)) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`threshold ${name} must be finite`);
    }
  }
  if (T.voiced < 0 || T.voiced > 1 || T.nucleusDip < 0 || T.landmarkRise <= 0) {
    throw new RangeError('invalid voicing, dip or rise threshold');
  }
  return T;
}

/**
 * A stage is invalid after trim/reset. `advance(true)` drains the final
 * lookahead, after the analyzer has been flushed. Returned nuclei are the
 * same objects appended to output.nuclei, and are never retracted.
 *
 * Closure clean-up is retrospective in batch mode. Streaming labels honour
 * the 60 ms commitment deadline; an open silence run is not relabelled after
 * commitment. See the counterexample in experiments/issue-62/causality.mjs.
 * @param {import('./frontend.js').FrameSet} frames
 * @param {import('./landmarks.js').LandmarkOptions} [options]
 */
export function createLandmarkDetector(frames, options = {}) {
  if (
    !(frames.hop > 0) ||
    !Number.isInteger(frames.capacity) ||
    frames.capacity < 0
  ) {
    throw new RangeError('invalid frame set');
  }
  const T = thresholds(options);
  const filters = sonorityFilters(frames);
  const raw = new Float32Array(frames.capacity);
  const rawClasses = new Uint8Array(frames.capacity);
  const output = {
    hop: frames.hop,
    startTime: frames.startTime,
    count: 0,
    committed: 0,
    classes: new Uint8Array(frames.capacity),
    sonority: new Float32Array(frames.capacity),
    landmarks: [],
    nuclei: [],
  };
  let seen = 0;
  let finalized = false;
  const radius = Math.round(0.04 / frames.hop);
  const smoothing = Math.ceil(0.02 / frames.hop);
  const landmarkDelay = Math.ceil(0.07 / frames.hop);
  const time = (t) => output.startTime + t * frames.hop;
  const s = output.sonority;
  const scanNuclei = createNucleusScanner(frames, output, T);

  function classifyPending(candidates) {
    for (let t = output.committed; t < seen; t++) {
      let peak = -Infinity;
      for (
        let j = Math.max(0, t - Math.round(0.2 / frames.hop));
        j <= Math.min(seen - 1, t + radius);
        j++
      ) {
        peak = Math.max(peak, s[j]);
      }
      const earlier = Math.max(0, t - Math.round(0.02 / frames.hop));
      const burst =
        (rawClasses[earlier] === 0 || rawClasses[earlier] === 6) &&
        candidates.some(
          (item) =>
            item.type === 'b+' &&
            item.t <= t &&
            (t - item.t) * frames.hop <= 0.02 + 1e-9
        );
      rawClasses[t] = classifyFrame(frames, s, t, peak, burst, T);
    }
  }

  return {
    frames,
    output,
    advance(final = false) {
      if (frames.startTime !== output.startTime || frames.count < seen) {
        throw new Error('landmark stage invalid after trim/reset');
      }
      if (finalized) {
        if (frames.count !== seen) {
          throw new Error('advance after final');
        }
        return [];
      }
      if (frames.count > frames.capacity) {
        throw new RangeError('frame count exceeds capacity');
      }
      fillSonority(frames, raw, seen, filters);
      smoothSonority(
        raw,
        s,
        Math.max(0, seen - smoothing),
        frames.count,
        frames.hop
      );
      seen = frames.count;
      output.count = seen;
      const emitted = [];
      const stable = final ? seen : Math.max(0, seen - smoothing - radius);
      scanNuclei(stable, emitted, final);
      const priorTime = output.landmarks.at(-1)?.time ?? -Infinity;
      const candidates = landmarkCandidates(
        frames,
        T.landmarkRise,
        Math.max(0, Math.floor((priorTime - output.startTime) / frames.hop) - 4)
      );
      const last = final ? seen : Math.max(0, seen - landmarkDelay);
      for (const item of candidates) {
        if (item.t < last && time(item.t) > priorTime + 1e-9) {
          output.landmarks.push({
            time: time(item.t),
            type: item.type,
            strength: item.strength,
          });
        }
      }
      classifyPending(candidates);
      const cleaned = cleanClasses(rawClasses, seen, frames.hop);
      output.classes.set(cleaned.subarray(output.committed), output.committed);
      output.committed = final
        ? seen
        : Math.max(0, seen - Math.ceil(0.06 / frames.hop));
      finalized = final;
      return emitted;
    },
  };
}

/** Whole-recording version of the same stage. */
export function findLandmarks(frames, options = {}) {
  const detector = createLandmarkDetector(frames, options);
  detector.advance(true);
  return detector.output;
}
