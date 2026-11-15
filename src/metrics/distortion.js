/**
 * Spectral distances between two recordings, frame by frame along an
 * alignment: the log-spectral distance (Gray & Markel 1976) and the
 * mel-cepstral distortion (Kubichek 1993).
 */

import { EPSILON, cepstra, powerFrames } from './spectrum.js';

/** RMS that `normalize` scales signals to. */
export const NORMALIZED_RMS = 0.1;
/** A frame this many dB below the loudest frame of its signal is silent. */
export const SILENCE_DB = 40;

/** Root mean square of a signal (0 when empty). */
export function rmsLevel(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index++) {
    sum += samples[index] * samples[index];
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

/**
 * Copy of a signal scaled to an RMS of `level` (a silent signal stays
 * silent).
 * @param {ArrayLike<number>} samples
 * @param {number} [level]
 * @returns {Float64Array}
 */
export function normalizeRms(samples, level = NORMALIZED_RMS) {
  const rms = rmsLevel(samples);
  const gain = rms > 0 ? level / rms : 1;
  const output = new Float64Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    output[index] = samples[index] * gain;
  }
  return output;
}

/** Pair frame t with frame t up to the shorter length. */
export function diagonalPath(n, m) {
  return Array.from({ length: Math.min(n, m) }, (_, index) => [index, index]);
}

/** For each power frame, whether it is SILENCE_DB below the loudest one. */
export function silentFrames(frames) {
  const totals = frames.map((power) => power.reduce((sum, p) => sum + p, 0));
  const loudest = totals.reduce((max, total) => Math.max(max, total), 0);
  const threshold = loudest * 10 ** (-SILENCE_DB / 10);
  return totals.map((total) => total < threshold);
}

function preparedFrames(reference, test, sampleRate, options) {
  const normalize = options.normalize ?? true;
  const signals = [reference, test].map((samples) =>
    normalize ? normalizeRms(samples) : samples
  );
  const [framesR, framesT] = signals.map((samples) =>
    powerFrames(samples, sampleRate, options)
  );
  const path = options.path ?? diagonalPath(framesR.length, framesT.length);
  return { framesR, framesT, path };
}

/**
 * Mean of `measure(i, j)` over the pairs of a path, skipping the pairs whose
 * frames are both silent; 0 when every pair is skipped.
 */
function meanOverPairs(path, silentR, silentT, measure) {
  let sum = 0;
  let count = 0;
  for (const [i, j] of path) {
    if (silentR[i] && silentT[j]) {
      continue;
    }
    sum += measure(i, j);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Log-spectral distance (dB): per pair of frames
 * sqrt(mean_k (10 log10(Pr[k] + EPSILON) - 10 log10(Pt[k] + EPSILON))^2)
 * over k = 1 .. size / 2, averaged over the pairs.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @param {number} sampleRate Rate of both signals.
 * @param {{path?: [number, number][], normalize?: boolean, window?: number, hop?: number}} [options]
 *   path pairs reference frame i with test frame j (default: frame t with
 *   frame t); normalize (default true) first scales both to an RMS of 0.1.
 * @returns {number}
 */
export function logSpectralDistance(reference, test, sampleRate, options = {}) {
  const { framesR, framesT, path } = preparedFrames(
    reference,
    test,
    sampleRate,
    options
  );
  const toDb = (frames) =>
    frames.map((power) => power.map((p) => 10 * Math.log10(p + EPSILON)));
  const [dbR, dbT] = [toDb(framesR), toDb(framesT)];
  return meanOverPairs(
    path,
    silentFrames(framesR),
    silentFrames(framesT),
    (i, j) => {
      const r = dbR[i];
      const t = dbT[j];
      let sum = 0;
      for (let k = 1; k < r.length; k++) {
        sum += (r[k] - t[k]) ** 2;
      }
      return Math.sqrt(sum / (r.length - 1));
    }
  );
}

/**
 * Mel-cepstral distortion (dB): per pair of frames
 * (10 / ln 10) sqrt(2 sum_{n=1..13} (cr[n] - ct[n])^2), averaged over the
 * pairs. c[0] is left out, so the value does not depend on gain.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @param {number} sampleRate Rate of both signals.
 * @param {{path?: [number, number][], normalize?: boolean, window?: number, hop?: number, filters?: number, coefficients?: number}} [options]
 * @returns {number}
 */
export function melCepstralDistortion(
  reference,
  test,
  sampleRate,
  options = {}
) {
  const { framesR, framesT, path } = preparedFrames(
    reference,
    test,
    sampleRate,
    options
  );
  const cr = cepstra(framesR, sampleRate, options);
  const ct = cepstra(framesT, sampleRate, options);
  const scale = 10 / Math.LN10;
  return meanOverPairs(
    path,
    silentFrames(framesR),
    silentFrames(framesT),
    (i, j) => {
      let sum = 0;
      for (let n = 1; n < cr[i].length; n++) {
        sum += (cr[i][n] - ct[j][n]) ** 2;
      }
      return scale * Math.sqrt(2 * sum);
    }
  );
}
