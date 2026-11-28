/**
 * Pitch track of a recording and the pitch errors between two tracks:
 * RMSE and mean in cents, gross pitch error (GPE; Rabiner et al. 1976),
 * voicing decision error (VDE) and f0 frame error (FFE; Chu & Alwan 2009).
 */

import {
  voiceAnalysisInput,
  createYinWorkspace,
  percentile,
  yinPitch,
} from '../analysis/voice-features.js';

/** A frame is unvoiced from this YIN aperiodicity on (as in analyzeVoice). */
export const VOICED_APERIODICITY = 0.35;
/** A frame quieter than this share of the 95th percentile level is silent. */
const QUIET_SHARE = 0.1;
/** Relative pitch difference above which a voiced frame is a gross error. */
const GROSS_ERROR = 0.2;

/**
 * Pitch (Hz) every `hop` seconds, 0 for unvoiced frames. The recording is
 * resampled to ANALYSIS_RATE and `yinPitch` runs on a window that starts at
 * t * hop; a frame is unvoiced when its level is below 10 % of the 95th
 * percentile of the frame levels or its aperiodicity is 0.35 or more.
 * There is one frame per hop that starts inside the signal (the end is
 * padded with zeros).
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{hop?: number, window?: number}} [options] Seconds (0.01, 0.04).
 * @returns {Float64Array}
 */
export function pitchTrack(samples, sampleRate, options = {}) {
  const { samples: signal, sampleRate: rate } = voiceAnalysisInput(
    samples,
    sampleRate
  );
  const hop = Math.max(1, Math.round((options.hop ?? 0.01) * rate));
  const length = Math.max(1, Math.round((options.window ?? 0.04) * rate));
  const count = Math.ceil(signal.length / hop);
  // YIN already treats look-ahead beyond the signal as zero. Only its
  // partial windows at the end need a padded set of reference samples.
  const tailStart = Math.max(0, signal.length - length);
  const tail = new Float64Array(signal.length - tailStart + length);
  tail.set(signal.subarray(tailStart));
  const levels = new Float64Array(count);
  for (let frame = 0; frame < count; frame++) {
    let sum = 0;
    const start = frame * hop;
    const end = Math.min(start + length, signal.length);
    for (let index = start; index < end; index++) {
      sum += signal[index] * signal[index];
    }
    levels[frame] = Math.sqrt(sum / length);
  }
  const quiet = QUIET_SHARE * percentile(levels, 0.95);
  const track = new Float64Array(count);
  const yin = createYinWorkspace(rate);
  for (let frame = 0; frame < count; frame++) {
    if (levels[frame] > 0 && levels[frame] >= quiet) {
      const start = frame * hop;
      const complete = start + length <= signal.length;
      const { f0, aperiodicity } = yinPitch(
        complete ? signal : tail,
        complete ? start : start - tailStart,
        length,
        rate,
        yin
      );
      track[frame] = aperiodicity < VOICED_APERIODICITY ? f0 : 0;
    }
  }
  return track;
}

function pearson(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let index = 0; index < n; index++) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    xy += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null;
}

/**
 * Pitch errors between two tracks (Hz, 0 = unvoiced) of equal length N (the
 * longer one is cut). V is the set of frames voiced in both and
 * e = 1200 log2(test / reference) the error in cents.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @returns {{rmseCents: number|null, meanCents: number|null, gpe: number|null, vde: number|null, ffe: number|null, correlation: number|null, voicedFrames: number, frames: number}}
 *   rmseCents = sqrt(mean_V e^2), meanCents = mean_V e, gpe = share of V
 *   with |test / reference - 1| > 0.2, vde = share of the N frames voiced in
 *   exactly one track, ffe = (gross errors + voicing errors) / N,
 *   correlation = Pearson correlation of log f0 over V. Values over V are
 *   null when V is empty (and the correlation when either side is flat).
 */
export function f0Errors(reference, test) {
  const frames = Math.min(reference.length, test.length);
  const cents = [];
  const logR = [];
  const logT = [];
  let gross = 0;
  let voicing = 0;
  for (let index = 0; index < frames; index++) {
    const r = reference[index];
    const t = test[index];
    if (r > 0 && t > 0) {
      cents.push(1200 * Math.log2(t / r));
      logR.push(Math.log(r));
      logT.push(Math.log(t));
      if (Math.abs(t / r - 1) > GROSS_ERROR) {
        gross++;
      }
    } else if (r > 0 || t > 0) {
      voicing++;
    }
  }
  const voiced = cents.length;
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / voiced;
  return {
    rmseCents: voiced ? Math.sqrt(mean(cents.map((e) => e * e))) : null,
    meanCents: voiced ? mean(cents) : null,
    gpe: voiced ? gross / voiced : null,
    vde: frames ? voicing / frames : null,
    ffe: frames ? (gross + voicing) / frames : null,
    correlation: voiced ? pearson(logR, logT) : null,
    voicedFrames: voiced,
    frames,
  };
}
