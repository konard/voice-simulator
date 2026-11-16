/**
 * Measures of the mode of speech in a recording (issue 52): the level and
 * the spectral balance (alpha ratio) of a stretch of samples. They follow
 * the vocal effort: the level by definition, the alpha ratio by about
 * 0.2 dB per dB of effort (Sundberg & Nordenberg 2006).
 */

import { fft, nextPowerOfTwo } from '../metrics/spectrum.js';

/** Floor under the power of an empty stretch or band (-200 dB). */
const FLOOR = 1e-20;

/** First and last sample index of a stretch, inside the samples. */
function stretch(samples, from, to) {
  const start = Math.max(0, Math.floor(from ?? 0));
  const end = Math.min(samples.length, Math.ceil(to ?? samples.length));
  return [start, Math.max(start, end)];
}

/**
 * Level of the samples from index `from` up to (not including) `to`: the
 * RMS in dB re full scale (a square wave of amplitude 1 is 0 dB, a sine of
 * amplitude 1 -3.01 dB). -200 dB for silence.
 * @param {ArrayLike<number>} samples
 * @param {number} [from] first sample index, default 0
 * @param {number} [to] end sample index, default the length
 */
export function levelDb(samples, from, to) {
  const [start, end] = stretch(samples, from, to);
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] * samples[index];
  }
  return 10 * Math.log10(Math.max(FLOOR, sum / Math.max(1, end - start)));
}

/**
 * Long-term average power spectrum of a stretch: Hann windows of about
 * 40 ms with half overlap (the last window zero-padded).
 * @returns {{power: Float64Array, binWidth: number}}
 */
export function averageSpectrum(samples, sampleRate, from, to) {
  const [start, end] = stretch(samples, from, to);
  const size = nextPowerOfTwo(Math.round(0.04 * sampleRate));
  const hop = size / 2;
  const window = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  const power = new Float64Array(size / 2 + 1);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let first = start; first < end; first += hop) {
    re.fill(0);
    im.fill(0);
    const count = Math.min(size, end - first);
    for (let index = 0; index < count; index++) {
      re[index] = samples[first + index] * window[index];
    }
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) {
      power[k] += re[k] * re[k] + im[k] * im[k];
    }
  }
  return { power, binWidth: sampleRate / size };
}

/** Summed power of the bins from `low` up to (not including) `high` Hz. */
function bandPower({ power, binWidth }, low, high) {
  let sum = 0;
  const first = Math.ceil(low / binWidth);
  const last = Math.min(power.length, Math.ceil(high / binWidth));
  for (let k = first; k < last; k++) {
    sum += power[k];
  }
  return sum;
}

/**
 * Alpha ratio of a stretch: the level of 1-5 kHz minus the level of
 * 50 Hz-1 kHz in the long-term average spectrum, in dB (Sundberg &
 * Nordenberg 2006). A flatter spectrum (more effort) gives a higher value.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} [from] first sample index, default 0
 * @param {number} [to] end sample index, default the length
 */
export function alphaRatio(samples, sampleRate, from, to) {
  const spectrum = averageSpectrum(samples, sampleRate, from, to);
  const high = bandPower(spectrum, 1000, Math.min(5000, sampleRate / 2));
  const low = bandPower(spectrum, 50, 1000);
  return 10 * Math.log10(Math.max(FLOOR, high) / Math.max(FLOOR, low));
}
