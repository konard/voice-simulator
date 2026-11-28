/**
 * Signal analysis used by tests, the benchmark and the UI: LPC formant
 * estimation, autocorrelation pitch and simple level statistics.
 */

import { Biquad } from './filters.js';

/**
 * Autocorrelation LPC with the Levinson-Durbin recursion.
 * @param {ArrayLike<number>} frame
 * @param {number} order
 * @returns {Float64Array} a[0..order] with a[0] = 1.
 */
export function lpcCoefficients(frame, order, scratch) {
  const r = scratch?.correlation ?? new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let index = lag; index < frame.length; index++) {
      sum += frame[index] * frame[index - lag];
    }
    r[lag] = sum;
  }
  r[0] *= 1 + 1e-9;
  const a = scratch?.predictor ?? new Float64Array(order + 1);
  a[0] = 1;
  let error = r[0] || 1e-12;
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) {
      acc += a[j] * r[i - j];
    }
    const k = -acc / error;
    for (let j = 1; j <= i / 2; j++) {
      const left = a[j];
      const right = a[i - j];
      a[j] = left + k * right;
      a[i - j] = right + k * left;
    }
    a[i] = k;
    error *= 1 - k * k;
  }
  return a;
}

function lpcMagnitude(a, frequency, sampleRate) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  let re = 0;
  let im = 0;
  for (let k = 0; k < a.length; k++) {
    re += a[k] * Math.cos(omega * k);
    im -= a[k] * Math.sin(omega * k);
  }
  return 1 / Math.hypot(re, im);
}

/** |1 / A(e^jw)| on a frequency grid. */
export function lpcEnvelope(a, sampleRate, step = 10) {
  const count = Math.floor(sampleRate / 2 / step);
  const frequencies = new Float64Array(count);
  const magnitudes = new Float64Array(count);
  for (let bin = 0; bin < count; bin++) {
    const frequency = (bin + 1) * step;
    frequencies[bin] = frequency;
    magnitudes[bin] = lpcMagnitude(a, frequency, sampleRate);
  }
  return { frequencies, magnitudes };
}

/**
 * Low-pass (fourth-order Butterworth at 0.45 times the new rate) and keep
 * every n-th sample, n the nearest integer to sampleRate / targetRate.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} targetRate
 * @returns {{samples: Float64Array, sampleRate: number}}
 */
export function decimate(samples, sampleRate, targetRate) {
  return decimateFrame(samples, sampleRate, targetRate);
}

function decimateFrame(samples, sampleRate, targetRate, workspace) {
  const factor = Math.max(1, Math.round(sampleRate / targetRate));
  const filters = workspace?.filters ?? [new Biquad(), new Biquad()];
  if (workspace?.filters) {
    filters[0].reset();
    filters[1].reset();
  } else {
    const cutoff = (sampleRate / factor) * 0.45;
    filters[0].lowpass(cutoff, 0.54, sampleRate);
    filters[1].lowpass(cutoff, 1.31, sampleRate);
    if (workspace) {
      workspace.filters = filters;
    }
  }
  const length = Math.floor(samples.length / factor);
  const frame = workspace?.frame;
  let output;
  if (frame && frame.length >= length) {
    output = frame.length === length ? frame : frame.subarray(0, length);
  } else {
    output = new Float64Array(length);
    if (workspace) {
      workspace.frame = output;
    }
  }
  for (let index = 0; index < output.length * factor; index++) {
    const value = filters[1].process(filters[0].process(samples[index]));
    if (index % factor === 0) {
      output[index / factor] = value;
    }
  }
  return { samples: output, sampleRate: sampleRate / factor };
}

/** Find LPC peaks as the grid is evaluated. Only the last three bins matter. */
function formantPeaks(a, rate, count) {
  const step = 5;
  const bins = Math.floor(rate / 2 / step);
  if (bins < 0 || bins === Infinity) {
    throw new RangeError('Invalid LPC frequency grid size');
  }
  const limit = Number.isInteger(count) && count >= 0 ? count : Infinity;
  const result = [];
  if (!(bins >= 3) || limit === 0) {
    return result;
  }
  let previous = lpcMagnitude(a, step, rate);
  let current = lpcMagnitude(a, 2 * step, rate);
  for (let bin = 3; bin <= bins; bin++) {
    const next = lpcMagnitude(a, bin * step, rate);
    const frequency = (bin - 1) * step;
    if (frequency > 150 && current > previous && current >= next) {
      result.push(frequency);
      if (result.length === limit) {
        return result;
      }
    }
    previous = current;
    current = next;
  }
  return limit === Infinity ? result.slice(0, count) : result;
}

/**
 * Estimate formant frequencies of a voiced stretch.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, duration?: number, order?: number, count?: number, analysisRate?: number}} [options]
 */
export function estimateFormants(samples, sampleRate, options = {}) {
  return estimateFormantFrame(samples, sampleRate, options);
}

/** Reuse the decimator, frame and LPC coefficients across adjacent windows. */
export function createFormantEstimator(samples, sampleRate, options) {
  const settings = { ...options };
  const length = (settings.order ?? 12) + 1;
  const workspace = {
    correlation: new Float64Array(length),
    predictor: new Float64Array(length),
  };
  return (start) => {
    settings.start = start;
    return estimateFormantFrame(samples, sampleRate, settings, workspace);
  };
}

function estimateFormantFrame(samples, sampleRate, options, workspace) {
  const start = Math.floor((options.start ?? 0) * sampleRate);
  const length = Math.floor((options.duration ?? 0.05) * sampleRate);
  const slice =
    (samples instanceof Float32Array || samples instanceof Float64Array) &&
    samples.buffer instanceof ArrayBuffer
      ? samples.subarray(start, start + length)
      : Array.prototype.slice.call(samples, start, start + length);
  const decimated = decimateFrame(
    slice,
    sampleRate,
    options.analysisRate ?? 11025,
    workspace
  );
  const frame = decimated.samples;
  for (let index = frame.length - 1; index > 0; index--) {
    frame[index] -= 0.94 * frame[index - 1];
  }
  for (let index = 0; index < frame.length; index++) {
    frame[index] *=
      0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frame.length - 1));
  }
  const order = options.order ?? 12;
  const a = lpcCoefficients(frame, order, workspace);
  return formantPeaks(a, decimated.sampleRate, options.count ?? 4);
}

/**
 * Share of the best autocorrelation score that a lag of a whole fraction
 * of the best lag needs to be taken instead (`estimatePitch()`). A steady
 * period between two whole lags fits a multiple of it better than either
 * neighbour: 199.5 Hz at 16 kHz is 80.2 samples, lags 80 and 81 score
 * 0.993 and lag 161 0.998 (experiments/issue-51-alto-acf.mjs).
 */
export const SUBHARMONIC_TOLERANCE = 0.98;

/**
 * Autocorrelation pitch estimate (Hz), or 0 when unvoiced. The shortest
 * whole fraction of the best lag that scores within
 * `SUBHARMONIC_TOLERANCE` of it wins, which avoids octave errors.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, duration?: number, min?: number, max?: number}} [options]
 */
export function estimatePitch(samples, sampleRate, options = {}) {
  const start = Math.floor((options.start ?? 0) * sampleRate);
  const length = Math.floor((options.duration ?? 0.06) * sampleRate);
  const minLag = Math.floor(sampleRate / (options.max ?? 500));
  const maxLag = Math.ceil(sampleRate / (options.min ?? 50));
  let energy = 0;
  for (let index = start; index < start + length; index++) {
    energy += samples[index] ** 2;
  }
  const scores = new Float64Array(maxLag + 1);
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = start; index < start + length; index++) {
      sum += samples[index] * (samples[index + lag] ?? 0);
    }
    const score = sum / (energy || 1);
    scores[lag] = score;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (best <= 0.3) {
    return 0;
  }
  return sampleRate / periodLag(scores, bestLag, minLag);
}

/**
 * The shortest whole fraction of `bestLag` (best of the three nearest
 * lags) that scores at least `SUBHARMONIC_TOLERANCE` of it, else `bestLag`.
 */
function periodLag(scores, bestLag, minLag) {
  const best = scores[bestLag];
  for (let divisor = Math.floor(bestLag / minLag); divisor >= 2; divisor--) {
    const centre = Math.round(bestLag / divisor);
    let lag = 0;
    for (let near = Math.max(minLag, centre - 1); near <= centre + 1; near++) {
      if (lag === 0 || scores[near] > scores[lag]) {
        lag = near;
      }
    }
    if (scores[lag] >= best * SUBHARMONIC_TOLERANCE) {
      return lag;
    }
  }
  return bestLag;
}

/** Root mean square level of a range. */
export function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Magnitude spectrum of an impulse response on a regular frequency grid
 * (direct DFT).
 * @param {ArrayLike<number>} response
 * @param {number} sampleRate
 * @param {{from?: number, to?: number, step?: number}} [options]
 * @returns {{frequencies: Float64Array, magnitudes: Float64Array}}
 */
export function impulseSpectrum(response, sampleRate, options = {}) {
  const { from = 100, to = 4000, step = 10 } = options;
  const count = Math.floor((to - from) / step) + 1;
  const frequencies = new Float64Array(count);
  const magnitudes = new Float64Array(count);
  for (let bin = 0; bin < count; bin++) {
    const frequency = from + bin * step;
    // Goertzel recursion: one cosine per bin.
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
    let previous = 0;
    let before = 0;
    for (let n = 0; n < response.length; n++) {
      const value = response[n] + coefficient * previous - before;
      before = previous;
      previous = value;
    }
    frequencies[bin] = frequency;
    magnitudes[bin] = Math.sqrt(
      Math.max(
        0,
        previous * previous + before * before - coefficient * previous * before
      )
    );
  }
  return { frequencies, magnitudes };
}

/**
 * Resonances of a magnitude spectrum: the frequency of each local maximum
 * (parabolic interpolation) above `from` Hz and its -3 dB bandwidth, the
 * width where the power falls to half the peak (linear interpolation
 * between grid points). A peak whose half-power point on a side is not
 * reached before a higher peak takes twice its width on the other side.
 * @param {{frequencies: ArrayLike<number>, magnitudes: ArrayLike<number>}} spectrum
 * @param {{count?: number, from?: number}} [options]
 * @returns {{frequency: number, bandwidth: number}[]}
 */
export function resonances({ frequencies, magnitudes }, options = {}) {
  const { count = 4, from = 100 } = options;
  const step = frequencies[1] - frequencies[0];
  const half = Math.SQRT1_2;
  const result = [];
  for (let index = 1; index < magnitudes.length - 1; index++) {
    const peak = magnitudes[index];
    if (
      frequencies[index] < from ||
      peak <= magnitudes[index - 1] ||
      peak < magnitudes[index + 1]
    ) {
      continue;
    }
    const level = peak * half;
    /** Distance (Hz) to the half-power point in a direction, or NaN. */
    const edge = (direction) => {
      let at = index;
      while (
        at + direction >= 0 &&
        at + direction < magnitudes.length &&
        magnitudes[at + direction] > level
      ) {
        at += direction;
        if (magnitudes[at] > peak) {
          return NaN;
        }
      }
      const next = at + direction;
      if (next < 0 || next >= magnitudes.length) {
        return NaN;
      }
      const fraction =
        (magnitudes[at] - level) / (magnitudes[at] - magnitudes[next]);
      return (Math.abs(at - index) + fraction) * step;
    };
    const lower = edge(-1);
    const upper = edge(1);
    const left = magnitudes[index - 1];
    const right = magnitudes[index + 1];
    const offset = (0.5 * (left - right)) / (left - 2 * peak + right || 1);
    const bandwidth = Number.isNaN(lower)
      ? 2 * upper
      : Number.isNaN(upper)
        ? 2 * lower
        : lower + upper;
    result.push({
      frequency: frequencies[index] + offset * step,
      bandwidth,
    });
  }
  return result.slice(0, count);
}

/**
 * Local maxima (Hz) of the magnitude spectrum of an impulse response,
 * evaluated with a direct DFT on a regular frequency grid. Peaks more than
 * `floor` dB below the strongest one are dropped, and so are peaks that
 * rise less than `prominence` dB above the lowest point between them and
 * the nearest higher magnitude on either side (ripples on the flank of a
 * formant).
 * @param {ArrayLike<number>} response
 * @param {number} sampleRate
 * @param {{from?: number, to?: number, step?: number, floor?: number, prominence?: number}} [options]
 */
export function spectralPeaks(response, sampleRate, options = {}) {
  const {
    from = 100,
    to = 4000,
    step = 10,
    floor = Infinity,
    prominence = 0,
  } = options;
  const spectrum = [];
  for (let frequency = from; frequency <= to; frequency += step) {
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * frequency) / sampleRate;
    for (let n = 0; n < response.length; n++) {
      re += response[n] * Math.cos(omega * n);
      im -= response[n] * Math.sin(omega * n);
    }
    spectrum.push([frequency, Math.hypot(re, im)]);
  }
  const magnitudes = spectrum.map(([, magnitude]) => magnitude);
  const strongest = Math.max(...magnitudes);
  const threshold = strongest * 10 ** (-floor / 20);
  const rise = 10 ** (prominence / 20);
  /** Lowest magnitude walking from a peak until a higher one (or the end). */
  const valley = (index, direction) => {
    let lowest = magnitudes[index];
    for (
      let at = index + direction;
      at >= 0 && at < magnitudes.length && magnitudes[at] <= magnitudes[index];
      at += direction
    ) {
      lowest = Math.min(lowest, magnitudes[at]);
    }
    return lowest;
  };
  return spectrum
    .filter(
      ([, magnitude], index) =>
        magnitude >= threshold &&
        index > 0 &&
        index < spectrum.length - 1 &&
        magnitude > spectrum[index - 1][1] &&
        magnitude > spectrum[index + 1][1] &&
        magnitude >= rise * Math.max(valley(index, -1), valley(index, 1))
    )
    .map(([frequency]) => frequency);
}

/**
 * Level (dB) of a sinusoid at a frequency (Hz) in a Hann-windowed range;
 * `search` (a fraction, 0.02 by default) tolerates pitch drift by keeping
 * the strongest of nine frequencies within ±search.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} frequency
 * @param {{start?: number, duration?: number, search?: number}} [options]
 */
export function harmonicLevel(samples, sampleRate, frequency, options = {}) {
  const start = Math.floor((options.start ?? 0) * sampleRate);
  const length = Math.floor((options.duration ?? 0.06) * sampleRate);
  const search = options.search ?? 0.02;
  let best = 0;
  for (let step = -4; step <= 4; step++) {
    const omega =
      (2 * Math.PI * frequency * (1 + (search * step) / 4)) / sampleRate;
    let re = 0;
    let im = 0;
    for (let index = 0; index < length; index++) {
      const value =
        (samples[start + index] ?? 0) *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length));
      re += value * Math.cos(omega * index);
      im -= value * Math.sin(omega * index);
    }
    best = Math.max(best, Math.hypot(re, im));
  }
  return 20 * Math.log10(best + 1e-12);
}

/**
 * Level (dB) that formants F1 and F2 (Hz) add at a frequency, for narrow
 * bandwidths and unit gain at 0 Hz: the vowel correction of Hanson (1997).
 * @param {number} frequency
 * @param {number[]} formants
 */
export function formantBoost(frequency, [f1, f2]) {
  return [f1, f2].reduce(
    (sum, formant) =>
      sum +
      20 * Math.log10(formant ** 2 / Math.abs(formant ** 2 - frequency ** 2)),
    0
  );
}

/**
 * Spectral tilt measures of a voiced range (dB) after Hanson (1997) and
 * Hanson and Chuang (1999): H1-H2 and H1-A3, A3 the strongest harmonic
 * within ±10% of F3, raw and corrected for F1 and F2 (H1*-H2*, H1*-A3*).
 * Corrected values are meaningful as differences between speakers, since
 * the neutral reference of the published correction is left out.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{f0: number, formants: number[], start?: number, duration?: number}} options
 *   `formants` F1-F3 (Hz).
 */
export function spectralTilt(samples, sampleRate, options) {
  const { f0, formants } = options;
  const level = (frequency) =>
    harmonicLevel(samples, sampleRate, frequency, options);
  const h1 = level(f0);
  const h2 = level(2 * f0);
  let a3 = -Infinity;
  for (
    let k = Math.ceil((0.9 * formants[2]) / f0);
    k * f0 <= 1.1 * formants[2];
    k++
  ) {
    a3 = Math.max(a3, level(k * f0));
  }
  const boost = (frequency) => formantBoost(frequency, formants);
  return {
    h1h2: h1 - h2,
    h1a3: h1 - a3,
    h1h2Corrected: h1 - h2 - boost(f0) + boost(2 * f0),
    h1a3Corrected: h1 - a3 - boost(f0) + boost(formants[2]),
  };
}
