/**
 * Voice features of a recording: the measurements that voice matching
 * compares between a recording and the simulator.
 *
 * - f0 (median and 5-95 % range) with YIN (de Cheveigné & Kawahara 2002);
 * - formants F1-F4 with LPC, and the formant spacing ΔF fitted to the
 *   uniform-tube pattern F_i = (2i - 1) ΔF / 2 (Reby & McComb 2003), which
 *   gives the vocal tract length L = c / (2 ΔF) (Fitch 1997);
 * - H1-H2, the level of the first harmonic over the second, which grows
 *   with a lax, breathy source (Hanson 1997);
 * - harmonics-to-noise ratio from the YIN aperiodicity;
 * - syllable rate from peaks of the loudness envelope.
 */

import { estimateFormants } from '../acoustics/analysis.js';
import { Biquad } from '../acoustics/filters.js';
import { SPEED_OF_SOUND } from '../acoustics/transfer.js';

/** Rate (Hz) recordings are resampled to before analysis. */
export const ANALYSIS_RATE = 11025;

const HOP = 0.01;
const WINDOW = 0.04;
const MIN_F0 = 60;
const MAX_F0 = 600;
const YIN_THRESHOLD = 0.15;
const VOICED_APERIODICITY = 0.35;
const FORMANT_FRAMES = 300;

/**
 * Low-pass and linearly interpolate to a lower rate (analysis quality).
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {number} [targetRate]
 * @returns {{samples: Float64Array, sampleRate: number}}
 */
export function resample(samples, sampleRate, targetRate = ANALYSIS_RATE) {
  if (sampleRate <= targetRate * 1.02) {
    return { samples: Float64Array.from(samples), sampleRate };
  }
  const filters = [new Biquad(), new Biquad()];
  filters[0].lowpass(0.45 * targetRate, 0.54, sampleRate);
  filters[1].lowpass(0.45 * targetRate, 1.31, sampleRate);
  const filtered = new Float64Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    filtered[index] = filters[1].process(filters[0].process(samples[index]));
  }
  const ratio = sampleRate / targetRate;
  const output = new Float64Array(Math.floor((samples.length - 1) / ratio));
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    output[index] =
      filtered[left] * (1 - fraction) + filtered[left + 1] * fraction;
  }
  return { samples: output, sampleRate: targetRate };
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = Float64Array.from(values).sort();
  const position = fraction * (sorted.length - 1);
  const left = Math.floor(position);
  const right = Math.min(sorted.length - 1, left + 1);
  return sorted[left] + (sorted[right] - sorted[left]) * (position - left);
}

/** Median of a list (0 when empty). */
export function median(values) {
  return percentile(values, 0.5);
}

function frameLevel(signal, start, length) {
  let sum = 0;
  for (let index = start; index < start + length; index++) {
    sum += signal[index] ** 2;
  }
  return Math.sqrt(sum / length);
}

/**
 * YIN pitch of one frame.
 * @returns {{f0: number, aperiodicity: number}}
 */
export function yinPitch(signal, start, length, sampleRate) {
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_F0));
  const maxLag = Math.ceil(sampleRate / MIN_F0);
  const normalized = new Float64Array(maxLag + 2);
  normalized[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let index = start; index < start + length; index++) {
      const delta = signal[index] - (signal[index + lag] ?? 0);
      sum += delta * delta;
    }
    running += sum;
    normalized[lag] = running > 0 ? (sum * lag) / running : 1;
  }
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] < YIN_THRESHOLD) {
      while (lag < maxLag && normalized[lag + 1] < normalized[lag]) {
        lag++;
      }
      best = lag;
      break;
    }
  }
  if (best < 0) {
    best = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < normalized[best]) {
        best = lag;
      }
    }
  }
  const before = normalized[best - 1];
  const after = normalized[best + 1];
  const curvature = before - 2 * normalized[best] + after;
  const shift = curvature > 0 ? (0.5 * (before - after)) / curvature : 0;
  return {
    f0: sampleRate / (best + Math.max(-0.5, Math.min(0.5, shift))),
    aperiodicity: Math.max(0, normalized[best]),
  };
}

function harmonicLevel(signal, start, length, frequency, sampleRate) {
  let best = 0;
  for (let step = -4; step <= 4; step++) {
    const omega = (2 * Math.PI * frequency * (1 + 0.025 * step)) / sampleRate;
    let re = 0;
    let im = 0;
    for (let index = 0; index < length; index++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
      const value = signal[start + index] * window;
      re += value * Math.cos(omega * index);
      im -= value * Math.sin(omega * index);
    }
    best = Math.max(best, Math.hypot(re, im));
  }
  return best;
}

/**
 * Formant spacing ΔF (Hz) that best fits F_i = (2i - 1) ΔF / 2 in the
 * least-squares sense.
 * @param {number[]} formants
 */
export function formantSpacing(formants) {
  let numerator = 0;
  let denominator = 0;
  formants.forEach((frequency, index) => {
    const order = index + 0.5;
    numerator += frequency * order;
    denominator += order * order;
  });
  return denominator > 0 ? numerator / denominator : 0;
}

function countSyllables(levels, voiced) {
  const smooth = levels.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -1; offset <= 1; offset++) {
      if (levels[index + offset] !== undefined) {
        sum += levels[index + offset];
        count++;
      }
    }
    return sum / count;
  });
  const decibels = smooth.map((value) => 20 * Math.log10(value + 1e-9));
  let count = 0;
  let valley = Infinity;
  let last = -Infinity;
  for (let index = 1; index < decibels.length - 1; index++) {
    valley = Math.min(valley, decibels[index]);
    const isPeak =
      voiced[index] &&
      decibels[index] >= decibels[index - 1] &&
      decibels[index] > decibels[index + 1];
    if (isPeak && decibels[index] - valley > 2 && index - last >= 6) {
      count++;
      last = index;
      valley = decibels[index];
    }
  }
  return count;
}

/**
 * Measure the voice features of a recording.
 * @param {ArrayLike<number>} samples Mono samples.
 * @param {number} sampleRate
 * @param {{maxDuration?: number, analysisRate?: number, order?: number}} [options]
 *   maxDuration (s) caps the analysed audio (default 30); order is the LPC
 *   order (default 1 + rate / 1000, 12 at the analysis rate).
 */
export function analyzeVoice(samples, sampleRate, options = {}) {
  const limit = Math.floor((options.maxDuration ?? 30) * sampleRate);
  const input =
    samples.length > limit
      ? Array.prototype.slice.call(samples, 0, limit)
      : samples;
  const { samples: signal, sampleRate: rate } = resample(
    input,
    sampleRate,
    options.analysisRate ?? ANALYSIS_RATE
  );
  const order = options.order ?? Math.round(rate / 1000) + 1;
  const hop = Math.round(HOP * rate);
  const length = Math.round(WINDOW * rate);
  const levels = [];
  for (let start = 0; start + length <= signal.length; start += hop) {
    levels.push(frameLevel(signal, start, length));
  }
  const loud = percentile(levels, 0.95);
  const active = levels.map((level) => level > Math.max(1e-4, 0.1 * loud));
  const frames = levels.map((level, index) => {
    if (!active[index]) {
      return { voiced: false };
    }
    const pitch = yinPitch(signal, index * hop, length, rate);
    return { ...pitch, voiced: pitch.aperiodicity < VOICED_APERIODICITY };
  });
  const voicedIndices = [];
  frames.forEach((frame, index) => {
    if (frame.voiced) {
      voicedIndices.push(index);
    }
  });
  const f0s = voicedIndices.map((index) => frames[index].f0);
  const f0 = median(f0s);
  const f0Low = percentile(f0s, 0.05);
  const f0High = percentile(f0s, 0.95);
  const stride = Math.max(1, voicedIndices.length / FORMANT_FRAMES);
  const tracks = [[], [], [], []];
  const spacings = [];
  const tilts = [];
  const noise = [];
  for (let pick = 0; pick < voicedIndices.length; pick += stride) {
    const index = voicedIndices[Math.floor(pick)];
    const start = index * hop;
    const formants = estimateFormants(signal, rate, {
      start: start / rate,
      duration: 0.03,
      count: 4,
      analysisRate: rate,
      order,
    });
    formants.forEach((value, order) => tracks[order].push(value));
    if (formants.length >= 3) {
      spacings.push(formantSpacing(formants));
    }
    const h1 = harmonicLevel(signal, start, length, frames[index].f0, rate);
    const h2 = harmonicLevel(signal, start, length, 2 * frames[index].f0, rate);
    tilts.push(20 * Math.log10((h1 + 1e-12) / (h2 + 1e-12)));
    const aperiodicity = Math.min(
      0.999,
      Math.max(1e-3, frames[index].aperiodicity)
    );
    noise.push(10 * Math.log10((1 - aperiodicity) / aperiodicity));
  }
  const spacing = median(spacings);
  const activeSeconds = active.filter(Boolean).length * HOP;
  return {
    duration: samples.length / sampleRate,
    activeDuration: activeSeconds,
    voicedDuration: voicedIndices.length * HOP,
    f0,
    f0Low,
    f0High,
    f0Range: f0Low > 0 ? 12 * Math.log2(f0High / f0Low) : 0,
    formants: tracks.map((track) => median(track)),
    formantSpacing: spacing,
    vocalTractLength: spacing > 0 ? SPEED_OF_SOUND / (2 * spacing) : 0,
    h1h2: median(tilts),
    hnr: median(noise),
    syllableRate:
      activeSeconds > 0
        ? countSyllables(
            levels,
            frames.map((frame) => frame.voiced)
          ) / activeSeconds
        : 0,
  };
}
