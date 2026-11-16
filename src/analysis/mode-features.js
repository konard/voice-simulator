/**
 * Measures of the mode of speech in a recording (issue 52): the level and
 * the spectral balance (alpha ratio) of a stretch of samples. They follow
 * the vocal effort: the level by definition, the alpha ratio by about
 * 0.2 dB per dB of effort (Sundberg & Nordenberg 2006).
 *
 * The whisper (issue 53) adds the share of voiced frames, the energy ratio
 * of the high to the low band and the spectral centre of gravity: a
 * whisper has no voiced frames and its energy lies higher (Zhang & Hansen
 * 2007; Jovičić & Šarić 2008).
 */

import { fft, nextPowerOfTwo } from '../metrics/spectrum.js';
import {
  ANALYSIS_RATE,
  percentile,
  resample,
  yinPitch,
} from './voice-features.js';

/** Length and hop (s) of the frames of frameAperiodicities. */
const FRAME = 0.03;
const FRAME_HOP = 0.01;

/** Frames below this level against the loud frames have no signal (-20 dB). */
export const SIGNAL_SHARE = 0.1;

/**
 * Frames that voicedShare judges: within -10 dB of the loud frames. The
 * weaker frames of a voice are its onsets and offsets, voiced closures and
 * fricatives, half noise or too short for YIN, and would count as
 * unvoiced; a whisper has none of either.
 */
export const VOICED_SHARE_SIGNAL = 0.3;

/** A frame with a YIN aperiodicity below this is voiced. */
export const VOICED_SHARE_APERIODICITY = 0.2;

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

/**
 * YIN aperiodicity (`yinPitch()`) of the frames with signal: 30 ms frames
 * every 10 ms of the samples at 11025 Hz, those with an RMS above `share`
 * (SIGNAL_SHARE, a tenth or -20 dB, by default) of the 95th percentile of
 * the frame levels. Near 0 for a periodic frame, near 1 for noise.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} [share]
 * @returns {number[]}
 */
export function frameAperiodicities(samples, sampleRate, share = SIGNAL_SHARE) {
  const { samples: signal, sampleRate: rate } = resample(
    samples,
    sampleRate,
    Math.min(sampleRate, ANALYSIS_RATE)
  );
  const length = Math.round(FRAME * rate);
  const hop = Math.round(FRAME_HOP * rate);
  const levels = [];
  for (let start = 0; start + length <= signal.length; start += hop) {
    let sum = 0;
    for (let index = start; index < start + length; index++) {
      sum += signal[index] * signal[index];
    }
    levels.push(Math.sqrt(sum / length));
  }
  const threshold = Math.max(1e-7, share * percentile(levels, 0.95));
  const result = [];
  levels.forEach((level, index) => {
    if (level > threshold) {
      result.push(yinPitch(signal, index * hop, length, rate).aperiodicity);
    }
  });
  return result;
}

/**
 * Share (0..1) of the loud frames (VOICED_SHARE_SIGNAL, see
 * frameAperiodicities) that are voiced: whose YIN aperiodicity is below
 * VOICED_SHARE_APERIODICITY. 0 without signal.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 */
export function voicedShare(samples, sampleRate) {
  const values = frameAperiodicities(samples, sampleRate, VOICED_SHARE_SIGNAL);
  if (values.length === 0) {
    return 0;
  }
  const voiced = values.filter((value) => value < VOICED_SHARE_APERIODICITY);
  return voiced.length / values.length;
}

/**
 * Energy ratio of a stretch: the level above 2.5 kHz minus the level of
 * 50 Hz to 1 kHz in the long-term average spectrum, in dB. A whisper has
 * more of its energy high.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} [from] first sample index, default 0
 * @param {number} [to] end sample index, default the length
 */
export function energyRatio(samples, sampleRate, from, to) {
  const spectrum = averageSpectrum(samples, sampleRate, from, to);
  const high = bandPower(spectrum, 2500, sampleRate / 2 + spectrum.binWidth);
  const low = bandPower(spectrum, 50, 1000);
  return 10 * Math.log10(Math.max(FLOOR, high) / Math.max(FLOOR, low));
}

/**
 * Spectral centre of gravity (Hz) of a stretch: the power-weighted mean
 * frequency of the long-term average spectrum above 50 Hz. 0 for silence.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} [from] first sample index, default 0
 * @param {number} [to] end sample index, default the length
 */
export function centreOfGravity(samples, sampleRate, from, to) {
  const { power, binWidth } = averageSpectrum(samples, sampleRate, from, to);
  let sum = 0;
  let weighted = 0;
  for (let k = Math.ceil(50 / binWidth); k < power.length; k++) {
    sum += power[k];
    weighted += power[k] * k * binWidth;
  }
  return sum > 0 ? weighted / sum : 0;
}
