/**
 * Spectral distances between two recordings, frame by frame along an
 * alignment: the log-spectral distance (Gray & Markel 1976) and the
 * mel-cepstral distortion (Kubichek 1993).
 */

import {
  DYNAMIC_RANGE_DB,
  cepstra,
  powerFloor,
  powerFrames,
} from './spectrum.js';

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
 * reference frame is silent (no speech to compare with there); 0 when every
 * pair is skipped. Before issue 19 a pair was skipped only when both frames
 * were silent, so a test signal that was never silent (white noise) was
 * also scored on the pauses and the background noise of the recording,
 * which it resembles, and came out closer to speech than a voice.
 */
function meanOverPairs(path, silentR, measure) {
  let sum = 0;
  let count = 0;
  for (const [i, j] of path) {
    if (silentR[i]) {
      continue;
    }
    sum += measure(i, j);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Log-spectral distance (dB): per pair of frames
 * sqrt(mean_k (10 log10(max(Pr[k], Fr)) - 10 log10(max(Pt[k], Ft)))^2)
 * over k = 1 .. size / 2, averaged over the pairs whose reference frame is
 * not silent (SILENCE_DB below the loudest reference frame). The floor F of a signal
 * is `range` dB (default DYNAMIC_RANGE_DB) below its largest bin power, and
 * at least EPSILON.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @param {number} sampleRate Rate of both signals.
 * @param {{path?: [number, number][], normalize?: boolean, window?: number, hop?: number, range?: number}} [options]
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
  return logSpectralDistanceOfFrames(
    framesR,
    framesT,
    path,
    silentFrames(framesR),
    options.range
  );
}

function convertToDb(frames, range) {
  const floor = powerFloor(frames, range);
  for (const power of frames) {
    for (let k = 1; k < power.length; k++) {
      power[k] = 10 * Math.log10(Math.max(power[k], floor));
    }
  }
}

/** Consumes the two private power matrices, converting their bins to dB. */
export function logSpectralDistanceOfFrames(
  reference,
  test,
  path,
  silent,
  range
) {
  convertToDb(reference, range ?? DYNAMIC_RANGE_DB);
  convertToDb(test, range ?? DYNAMIC_RANGE_DB);
  return meanOverPairs(path, silent, (i, j) => {
    const r = reference[i];
    const t = test[j];
    let sum = 0;
    for (let k = 1; k < r.length; k++) {
      sum += (r[k] - t[k]) ** 2;
    }
    return Math.sqrt(sum / (r.length - 1));
  });
}

/**
 * Mel-cepstral distortion (dB): per pair of frames
 * (10 / ln 10) sqrt(2 sum_{n=1..13} (cr[n] - ct[n])^2), averaged over the
 * pairs whose reference frame is not silent (as for the log-spectral
 * distance). c[0] is left out, so the value does not depend on gain.
 * @param {ArrayLike<number>} reference
 * @param {ArrayLike<number>} test
 * @param {number} sampleRate Rate of both signals.
 * @param {{path?: [number, number][], normalize?: boolean, window?: number, hop?: number, filters?: number, coefficients?: number, range?: number}} [options]
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
  return melCepstralDistance(cr, ct, path, silentFrames(framesR));
}

/** Score precomputed cepstra along the alignment. */
export function melCepstralDistance(cr, ct, path, silent) {
  const scale = 10 / Math.LN10;
  return meanOverPairs(path, silent, (i, j) => {
    let sum = 0;
    for (let n = 1; n < cr[i].length; n++) {
      sum += (cr[i][n] - ct[j][n]) ** 2;
    }
    return scale * Math.sqrt(2 * sum);
  });
}

/**
 * Mel-cepstral distortion of a recording from its own mean cepstrum: the
 * distortion `melCepstralDistortion` gives a test signal whose spectrum
 * never changes and has the mean shape of the reference (issue 150). The
 * mean is taken over the frames that are not silent, which are also the
 * only frames scored. A render-back that does not beat this value has not
 * followed any spectral change of the recording. It needs no test signal,
 * so it is a per-utterance reference point for the golden-set error.
 * @param {ArrayLike<number>} reference
 * @param {number} sampleRate
 * @param {{normalize?: boolean, window?: number, hop?: number, filters?: number, coefficients?: number, range?: number}} [options]
 * @returns {number}
 */
export function constantCepstrumDistortion(
  reference,
  sampleRate,
  options = {}
) {
  const normalize = options.normalize ?? true;
  const frames = powerFrames(
    normalize ? normalizeRms(reference) : reference,
    sampleRate,
    options
  );
  const cr = cepstra(frames, sampleRate, options);
  const silent = silentFrames(frames);
  const scored = cr.filter((_, index) => !silent[index]);
  if (scored.length === 0) {
    return 0;
  }
  const mean = new Float64Array(scored[0].length);
  for (const c of scored) {
    for (let n = 1; n < mean.length; n++) {
      mean[n] += c[n] / scored.length;
    }
  }
  const scale = 10 / Math.LN10;
  let total = 0;
  for (const c of scored) {
    let sum = 0;
    for (let n = 1; n < mean.length; n++) {
      sum += (c[n] - mean[n]) ** 2;
    }
    total += scale * Math.sqrt(2 * sum);
  }
  return total / scored.length;
}
