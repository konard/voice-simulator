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
export function lpcCoefficients(frame, order) {
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let index = lag; index < frame.length; index++) {
      sum += frame[index] * frame[index - lag];
    }
    r[lag] = sum;
  }
  r[0] *= 1 + 1e-9;
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let error = r[0] || 1e-12;
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) {
      acc += a[j] * r[i - j];
    }
    const k = -acc / error;
    const previous = Float64Array.from(a);
    for (let j = 1; j < i; j++) {
      a[j] = previous[j] + k * previous[i - j];
    }
    a[i] = k;
    error *= 1 - k * k;
  }
  return a;
}

/** |1 / A(e^jw)| on a frequency grid. */
export function lpcEnvelope(a, sampleRate, step = 10) {
  const count = Math.floor(sampleRate / 2 / step);
  const frequencies = new Float64Array(count);
  const magnitudes = new Float64Array(count);
  for (let bin = 0; bin < count; bin++) {
    const frequency = (bin + 1) * step;
    const omega = (2 * Math.PI * frequency) / sampleRate;
    let re = 0;
    let im = 0;
    for (let k = 0; k < a.length; k++) {
      re += a[k] * Math.cos(omega * k);
      im -= a[k] * Math.sin(omega * k);
    }
    frequencies[bin] = frequency;
    magnitudes[bin] = 1 / Math.hypot(re, im);
  }
  return { frequencies, magnitudes };
}

function decimate(samples, sampleRate, targetRate) {
  const factor = Math.max(1, Math.round(sampleRate / targetRate));
  const filters = [new Biquad(), new Biquad()];
  const cutoff = (sampleRate / factor) * 0.45;
  filters[0].lowpass(cutoff, 0.54, sampleRate);
  filters[1].lowpass(cutoff, 1.31, sampleRate);
  const output = new Float64Array(Math.floor(samples.length / factor));
  for (let index = 0; index < output.length * factor; index++) {
    const value = filters[1].process(filters[0].process(samples[index]));
    if (index % factor === 0) {
      output[index / factor] = value;
    }
  }
  return { samples: output, sampleRate: sampleRate / factor };
}

function peaks({ frequencies, magnitudes }, minimum = 150) {
  const result = [];
  for (let index = 1; index < magnitudes.length - 1; index++) {
    if (
      frequencies[index] > minimum &&
      magnitudes[index] > magnitudes[index - 1] &&
      magnitudes[index] >= magnitudes[index + 1]
    ) {
      result.push(frequencies[index]);
    }
  }
  return result;
}

/**
 * Estimate formant frequencies of a voiced stretch.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, duration?: number, order?: number, count?: number, analysisRate?: number}} [options]
 */
export function estimateFormants(samples, sampleRate, options = {}) {
  const start = Math.floor((options.start ?? 0) * sampleRate);
  const length = Math.floor((options.duration ?? 0.05) * sampleRate);
  const slice = Array.prototype.slice.call(samples, start, start + length);
  const decimated = decimate(slice, sampleRate, options.analysisRate ?? 11025);
  const frame = decimated.samples;
  for (let index = frame.length - 1; index > 0; index--) {
    frame[index] -= 0.94 * frame[index - 1];
  }
  for (let index = 0; index < frame.length; index++) {
    frame[index] *=
      0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frame.length - 1));
  }
  const order = options.order ?? 12;
  const a = lpcCoefficients(frame, order);
  return peaks(lpcEnvelope(a, decimated.sampleRate, 5)).slice(
    0,
    options.count ?? 4
  );
}

/**
 * Autocorrelation pitch estimate (Hz), or 0 when unvoiced.
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
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = start; index < start + length; index++) {
      sum += samples[index] * (samples[index + lag] ?? 0);
    }
    const score = sum / (energy || 1);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return best > 0.3 ? sampleRate / bestLag : 0;
}

/** Root mean square level of a range. */
export function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}
