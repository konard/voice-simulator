/**
 * Voice features of a recording: the measurements that voice matching
 * compares between a recording and the simulator.
 *
 * - f0 (median and 5-95 % range) with the shared pitch tracker;
 * - tracked formants F1-F4 (F1-F3 at 8 kHz), and the formant spacing ΔF
 *   fitted to the uniform-tube pattern F_i = (2i - 1) ΔF / 2 (Reby &
 *   McComb 2003), which gives the vocal tract length L = c / (2 ΔF)
 *   (Fitch 1997);
 * - H1-H2, the level of the first harmonic over the second, which grows
 *   with a lax, breathy source (Hanson 1997);
 * - harmonics-to-noise ratio from the YIN aperiodicity of frames resampled
 *   to a constant pitch, so that pitch movement does not read as noise,
 *   taken above 400 Hz at the best fractional lag, and summed up by the
 *   upper quartile over frames;
 * - syllable rate from peaks of the loudness envelope.
 * analyzeLegacyVoice retains YIN and the previous independent LPC analysis.
 */

import {
  accumulate,
  emptyState,
  stateFeatures,
} from './voice-fit-statistics.js';
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
/** Largest pitch slope (per second, relative to f0) that is straightened. */
const MAX_SLOPE = 4;
/**
 * Corner (Hz) of the high-pass before HNR. It removes the first harmonics,
 * whose share of the energy grows with a lax source (that is what H1-H2
 * measures) and which line up from period to period even when jitter and
 * moving formants spoil the upper ones, so a smoother pulse would otherwise
 * read as a cleaner voice. The breath noise of the source lies above it.
 */
const HNR_HIGHPASS = 400;
/**
 * HNR is the upper quartile of the frame values: transitions (moving
 * formants, onsets and offsets) read as noise whatever the voice, and they
 * fill about half the voiced frames of running speech.
 */
const HNR_PERCENTILE = 0.75;
/** Step and half-width (samples) of the fractional lag search for HNR. */
const LAG_STEP = 0.1;
const LAG_SPAN = 0.6;
const LAG_STEPS = Math.round(LAG_SPAN / LAG_STEP);

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
  const ratio = sampleRate / targetRate;
  const output = new Float64Array(Math.floor((samples.length - 1) / ratio));
  let index = 0;
  let position = 0;
  let left = 0;
  let previous = 0;
  for (let read = 0; read < samples.length; read++) {
    const value = filters[1].process(filters[0].process(samples[read]));
    if (index < output.length && read === left + 1) {
      const fraction = position - left;
      output[index++] = previous * (1 - fraction) + value * fraction;
      position = index * ratio;
      left = Math.floor(position);
    }
    previous = value;
  }
  return { samples: output, sampleRate: targetRate };
}

/** Reuse an already suitable waveform during synchronous read-only analysis. */
export function voiceAnalysisInput(
  samples,
  sampleRate,
  targetRate = ANALYSIS_RATE
) {
  if (
    sampleRate <= targetRate * 1.02 &&
    (samples instanceof Float32Array || samples instanceof Float64Array) &&
    samples.buffer instanceof ArrayBuffer
  ) {
    return { samples, sampleRate };
  }
  return resample(samples, sampleRate, targetRate);
}

/** Linear-interpolated percentile of a list (`fraction` 0 to 1; 0 when empty). */
export function percentile(values, fraction) {
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

/** Scratch storage shared by sequential YIN frames at one sample rate. */
export function createYinWorkspace(sampleRate) {
  return new Float64Array(Math.ceil(sampleRate / MIN_F0) + 2);
}

/**
 * First dip below the YIN threshold, with its neighbours measured for
 * interpolation. Without a dip, return the lowest measured lag.
 */
function yinLag(signal, start, length, minLag, maxLag, normalized) {
  normalized[0] = 1;
  let running = 0;
  let below = false;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let index = start; index < start + length; index++) {
      const delta = signal[index] - (signal[index + lag] ?? 0);
      sum += delta * delta;
    }
    running += sum;
    normalized[lag] = running > 0 ? (sum * lag) / running : 1;
    if (lag >= minLag) {
      if (below && (lag > maxLag || !(normalized[lag] < normalized[lag - 1]))) {
        return lag - 1;
      }
      below ||= normalized[lag] < YIN_THRESHOLD;
    }
  }
  let best = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (normalized[lag] < normalized[best]) {
      best = lag;
    }
  }
  return best;
}

/**
 * YIN pitch of one frame.
 * @returns {{f0: number, aperiodicity: number}}
 */
export function yinPitch(
  signal,
  start,
  length,
  sampleRate,
  normalized = createYinWorkspace(sampleRate),
  pitch = { f0: 0, aperiodicity: 0 }
) {
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_F0));
  const maxLag = Math.ceil(sampleRate / MIN_F0);
  const best = yinLag(signal, start, length, minLag, maxLag, normalized);
  const before = normalized[best - 1];
  const after = normalized[best + 1];
  const curvature = before - 2 * normalized[best] + after;
  const shift = curvature > 0 ? (0.5 * (before - after)) / curvature : 0;
  pitch.f0 = sampleRate / (best + Math.max(-0.5, Math.min(0.5, shift)));
  pitch.aperiodicity = Math.max(0, normalized[best]);
  return pitch;
}

/** Cubic (Catmull-Rom) interpolation of a signal at a fractional index. */
function cubicAt(signal, position) {
  const index = Math.floor(position);
  const x = position - index;
  const last = signal.length - 1;
  const p0 = signal[Math.min(last, Math.max(0, index - 1))] ?? 0;
  const p1 = signal[Math.min(last, Math.max(0, index))] ?? 0;
  const p2 = signal[Math.min(last, Math.max(0, index + 1))] ?? 0;
  const p3 = signal[Math.min(last, Math.max(0, index + 2))] ?? 0;
  return (
    p1 +
    0.5 *
      x *
      (p2 -
        p0 +
        x * (2 * p0 - 5 * p1 + 4 * p2 - p3 + x * (3 * (p1 - p2) + p3 - p0)))
  );
}

/**
 * Resample a stretch of signal so that its pitch is constant: with the pitch
 * f0 + slope t around the middle of the stretch, the phase grows as
 * f0 t + slope t² / 2, so output time t is read from input time
 * t - slope t² / (2 f0) (to second order). A gliding voice then repeats
 * itself period by period, as YIN assumes.
 * @param {ArrayLike<number>} signal
 * @param {number} start First sample of the stretch.
 * @param {Float64Array} output Workspace for the resampled stretch.
 * @param {number} sampleRate
 * @param {number} slope Pitch change (Hz per second).
 * @param {number} f0 Pitch (Hz) in the middle of the stretch.
 */
function straighten(signal, start, output, sampleRate, slope, f0) {
  const { length } = output;
  const middle = start + length / 2;
  const warp = slope / (2 * f0);
  for (let n = 0; n < length; n++) {
    const t = (n - length / 2) / sampleRate;
    output[n] = cubicAt(signal, middle + (t - warp * t * t) * sampleRate);
  }
}

/**
 * Pitch slope (Hz per second) at a voiced frame from the pitch of the frames
 * before and after it; 0 when one of them is unvoiced. Limited to
 * MAX_SLOPE f0 per second.
 */
function pitchSlope(pitches, index, f0) {
  const previous = pitches[index - 1];
  const next = pitches[index + 1];
  if (!previous || !next) {
    return 0;
  }
  const limit = MAX_SLOPE * f0;
  return Math.max(-limit, Math.min(limit, (next - previous) / (2 * HOP)));
}

/**
 * YIN aperiodicity of a voiced frame after its pitch movement is taken out.
 * The stretch covers the frame and the longest lag YIN compares it with.
 */
function straightAperiodicity(signal, pitches, index, scratch) {
  const { hop, length, rate, straight, differences } = scratch;
  const f0 = pitches[index];
  const slope = pitchSlope(pitches, index, f0);
  straighten(signal, index * hop, straight, rate, slope, f0);
  return fractionalAperiodicity(straight, length, rate / f0, differences);
}

/**
 * Mean of the YIN difference function over the lags 1 to `lags`, which
 * normalizes it (de Cheveigné & Kawahara 2002, step 3).
 */
function meanDifference(signal, length, lags) {
  let total = 0;
  for (let lag = 1; lag <= lags; lag++) {
    for (let index = 0; index < length; index++) {
      total += (signal[index] - signal[index + lag]) ** 2;
    }
  }
  return total / lags;
}

function fractionalDifference(signal, length, lag, mean) {
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum += (signal[index] - cubicAt(signal, index + lag)) ** 2;
  }
  return sum / mean;
}

/**
 * YIN aperiodicity at the best fractional lag near the period. A period is
 * rarely a whole number of samples, and at the nearest integer lag the upper
 * harmonics no longer line up: frames of a noise-free gliding [aː] read 20
 * to 28 dB there and 31 to 33 dB at the best lag
 * (experiments/issue-32-fractional-lag.mjs). The lag is searched in steps of LAG_STEP samples and
 * refined with a parabola; the signal is read at fractional positions by
 * cubic interpolation.
 */
function fractionalAperiodicity(signal, length, period, values) {
  const mean = meanDifference(signal, length, Math.round(period));
  if (!(mean > 0)) {
    return 1;
  }
  let at = 0;
  for (let step = 0; step < values.length; step++) {
    const lag = period + (step - LAG_STEPS) * LAG_STEP;
    const value = fractionalDifference(signal, length, lag, mean);
    values[step] = value;
    if (value < values[at]) {
      at = step;
    }
  }
  let lowest = values[at];
  if (at > 0 && at < values.length - 1) {
    const curvature = values[at - 1] - 2 * values[at] + values[at + 1];
    if (curvature > 0) {
      const shift = (0.5 * (values[at - 1] - values[at + 1])) / curvature;
      const lag = period + (at - LAG_STEPS + shift) * LAG_STEP;
      lowest = Math.min(
        lowest,
        fractionalDifference(signal, length, lag, mean)
      );
    }
  }
  return lowest;
}

/** Fourth-order Butterworth high-pass (two biquads). */
function highpass(signal, frequency, rate) {
  const filters = [new Biquad(), new Biquad()];
  filters[0].highpass(frequency, 0.54, rate);
  filters[1].highpass(frequency, 1.31, rate);
  return signal.map((value) => filters[1].process(filters[0].process(value)));
}

function harmonicLevel(windowed, frequency, sampleRate) {
  let best = 0;
  for (let step = -4; step <= 4; step++) {
    const omega = (2 * Math.PI * frequency * (1 + 0.025 * step)) / sampleRate;
    let re = 0;
    let im = 0;
    for (let index = 0; index < windowed.length; index++) {
      const value = windowed[index];
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
  const decibels = new Float64Array(levels.length);
  for (let index = 0; index < levels.length; index++) {
    let sum = 0;
    let count = 0;
    for (let offset = -1; offset <= 1; offset++) {
      if (levels[index + offset] !== undefined) {
        sum += levels[index + offset];
        count++;
      }
    }
    decibels[index] = 20 * Math.log10(sum / count + 1e-9);
  }
  let count = 0;
  let valley = Infinity;
  let last = -Infinity;
  for (let index = 1; index < decibels.length - 1; index++) {
    valley = Math.min(valley, decibels[index]);
    const isPeak =
      decibels[index] >= decibels[index - 1] &&
      decibels[index] > decibels[index + 1] &&
      voiced(index);
    if (isPeak && decibels[index] - valley > 2 && index - last >= 6) {
      count++;
      last = index;
      valley = decibels[index];
    }
  }
  return count;
}

export function sliceVoiceSamples(samples, limit) {
  return samples instanceof Float32Array || samples instanceof Float64Array
    ? samples.subarray(0, limit)
    : Array.prototype.slice.call(samples, 0, limit);
}

/**
 * Measure the voice features of a recording.
 * @param {ArrayLike<number>} samples Mono samples.
 * @param {number} sampleRate
 * @param {{maxDuration?: number, analysisRate?: number, order?: number, formantCount?: number}} [options]
 *   maxDuration (s) caps the analysed audio (default 30); order is the LPC
 *   order (default 1 + rate / 1000, 12 at the analysis rate). formantCount
 *   is the number of formants measured and fitted for the formant spacing
 *   and the vocal tract length (default min(4, floor(0.45 rate / 1000)),
 *   where rate is the rate after resampling: 3 at 8000 Hz, 4 from
 *   11025 Hz, so that no formant is looked for above the band of
 *   telephone speech). `formants` always has four entries; those that
 *   were not measured are 0.
 */
export function prepareLegacyVoice(samples, sampleRate, options = {}) {
  const limit = Math.floor((options.maxDuration ?? 30) * sampleRate);
  const input =
    samples.length > limit ? sliceVoiceSamples(samples, limit) : samples;
  const { samples: signal, sampleRate: rate } = resample(
    input,
    sampleRate,
    options.analysisRate ?? ANALYSIS_RATE
  );
  const order = options.order ?? Math.round(rate / 1000) + 1;
  const formantCount =
    options.formantCount ?? Math.min(4, Math.floor((0.45 * rate) / 1000));
  const hop = Math.round(HOP * rate);
  const length = Math.round(WINDOW * rate);
  const count = Math.max(0, Math.floor((signal.length - length) / hop) + 1);
  const levels = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    levels[i] = frameLevel(signal, i * hop, length);
  }
  const loud = percentile(levels, 0.95);
  const threshold = Math.max(1e-4, 0.1 * loud);
  const pending = new Uint8Array(count);
  const pitches = new Float64Array(count);
  let activeFrames = 0;
  for (let i = 0; i < count; i++) {
    if (levels[i] > threshold) {
      pending[i] = 1;
      activeFrames++;
    }
  }
  const yin = createYinWorkspace(rate);
  const pitch = { f0: 0, aperiodicity: 0 };
  let evaluated = 0;
  function isVoiced(index) {
    if (pending[index]) {
      yinPitch(signal, index * hop, length, rate, yin, pitch);
      if (pitch.aperiodicity < VOICED_APERIODICITY) {
        pitches[index] = pitch.f0;
      }
      pending[index] = 0;
      evaluated++;
    }
    return pitches[index] > 0;
  }
  const activeSeconds = activeFrames * HOP;
  let syllables;
  const rateFeatures = {
    duration: samples.length / sampleRate,
    activeDuration: activeSeconds,
    get syllableRate() {
      return activeSeconds > 0
        ? (syllables ??= countSyllables(levels, isVoiced)) / activeSeconds
        : 0;
    },
  };
  const tracePitch = (phase) =>
    options.trace?.({
      stage: 'legacy-voice-pitch',
      phase,
      evaluated,
      activeFrames,
    });
  if (options.trace) {
    void rateFeatures.syllableRate;
    tracePitch('rate');
  }
  const voicedIndices = [];
  let features = null;
  function pitchFeatures() {
    if (!features) {
      for (let index = 0; index < count; index++) {
        if (isVoiced(index)) {
          voicedIndices.push(index);
        }
      }
      const f0s = voicedIndices.map((index) => pitches[index]);
      const f0Low = percentile(f0s, 0.05);
      const f0High = percentile(f0s, 0.95);
      features = {
        duration: rateFeatures.duration,
        activeDuration: activeSeconds,
        voicedDuration: voicedIndices.length * HOP,
        f0: median(f0s),
        f0Low,
        f0High,
        f0Range: f0Low > 0 ? 12 * Math.log2(f0High / f0Low) : 0,
        formants: [0, 0, 0, 0],
        formantSpacing: 0,
        vocalTractLength: 0,
        h1h2: 0,
        hnr: 0,
        syllableRate: rateFeatures.syllableRate,
      };
      tracePitch('features');
    }
    return features;
  }
  let completed = false;
  return {
    rateFeatures,
    get features() {
      return pitchFeatures();
    },
    complete() {
      pitchFeatures();
      if (!completed) {
        Object.assign(
          features,
          legacyDiagnostics(signal, rate, pitches, voicedIndices, {
            ...options,
            order,
            formantCount,
            hop,
            length,
          })
        );
        completed = true;
      }
      return features;
    },
  };
}

function legacyDiagnostics(signal, rate, pitches, voicedIndices, options) {
  const { order, formantCount, hop, length } = options;
  const diagnosticFrames = voicedIndices.length;
  const stride = Math.max(1, diagnosticFrames / FORMANT_FRAMES);
  const upper = highpass(signal, HNR_HIGHPASS, rate);
  const tracks = [[], [], [], []];
  const spacings = [];
  const tilts = [];
  const noise = [];
  const hann = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    hann[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
  }
  const windowed = new Float64Array(length);
  const hnrScratch = {
    hop,
    length,
    rate,
    straight: new Float64Array(length + Math.ceil(rate / MIN_F0) + 2),
    differences: new Float64Array(2 * LAG_STEPS + 1),
  };
  for (let pick = 0; pick < diagnosticFrames; pick += stride) {
    const index = voicedIndices[Math.floor(pick)];
    const start = index * hop;
    const formants = options.diagnosticsOnly
      ? []
      : estimateFormants(signal, rate, {
          start: start / rate,
          duration: 0.03,
          count: formantCount,
          analysisRate: rate,
          order,
        });
    formants.slice(0, 4).forEach((value, order) => tracks[order].push(value));
    if (formants.length >= 3) {
      spacings.push(formantSpacing(formants));
    }
    for (let n = 0; n < length; n++) {
      windowed[n] = signal[start + n] * hann[n];
    }
    const h1 = harmonicLevel(windowed, pitches[index], rate);
    const h2 = harmonicLevel(windowed, 2 * pitches[index], rate);
    tilts.push(20 * Math.log10((h1 + 1e-12) / (h2 + 1e-12)));
    const aperiodicity = Math.min(
      0.999,
      Math.max(1e-3, straightAperiodicity(upper, pitches, index, hnrScratch))
    );
    noise.push(10 * Math.log10((1 - aperiodicity) / aperiodicity));
  }
  const spacing = median(spacings);
  return {
    formants: tracks.map((track) => median(track)),
    formantSpacing: spacing,
    vocalTractLength: spacing > 0 ? SPEED_OF_SOUND / (2 * spacing) : 0,
    h1h2: median(tilts),
    hnr: percentile(noise, HNR_PERCENTILE),
  };
}

/** Eager compatibility entry point; fitting can retain the prepared analysis. */
export function analyzeLegacyVoice(samples, sampleRate, options = {}) {
  const analysis = prepareLegacyVoice(samples, sampleRate, options);
  return options.sourceDiagnostics === false
    ? analysis.features
    : analysis.complete();
}

/** Shared stage-A statistics; legacy diagnostics remain available internally. */
export function analyzeVoice(samples, sampleRate, options = {}) {
  const features = stateFeatures(
    accumulate(emptyState(), samples, sampleRate, {
      ...options,
      retainNucleiCarry: false,
    })
  );
  delete features.rd;
  delete features.cpp;
  delete features.h1h2Source;
  return features;
}
