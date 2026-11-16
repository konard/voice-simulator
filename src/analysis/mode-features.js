/**
 * Measures of the mode of speech in a recording (issue 52): the level and
 * the spectral balance (alpha ratio) of a stretch of samples. They follow
 * the vocal effort: the level by definition, the alpha ratio by about
 * 0.2 dB per dB of effort (Sundberg & Nordenberg 2006).
 *
 * Measures of the phonation (issue 54): the cepstral peak prominence
 * (`cpp()`, Hillenbrand, Cleveland and Erickson 1994), lower for a breathy
 * voice, and the glottal periods (`glottalPeriods()`) with their jitter
 * (`jitterPercent()`) and f0 (`pulseF0()`), which follow a creaky voice
 * below the 60 Hz floor of the YIN pitch of analyzeVoice().
 */

import { fft, nextPowerOfTwo } from '../metrics/spectrum.js';
import { decimate, lpcCoefficients } from '../acoustics/analysis.js';

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
 * Settings of the phonation measures: the analysis rate (Hz), the frame
 * hop (s) of the voicing decision, the CPP frame (s) and quefrency range
 * (Hz, 1/300 to 1/60 s), the shortest and longest period (s) of a pulse
 * train and the share of the loudest nearby pulse that a pulse must reach.
 */
export const PHONATION_ANALYSIS = Object.freeze({
  rate: 22050,
  hop: 0.01,
  window: 0.04,
  cppHigh: 300,
  cppLow: 60,
  minPeriod: 1 / 500,
  maxPeriod: 1 / 20,
  pulseShare: 0.1,
  /** A frame is voiced when it is at most 20 dB below the loud ones... */
  levelShare: 0.1,
  /** ...and at least this share of its power lies below 1 kHz. */
  lowShare: 0.3,
});

/** The samples at the analysis rate (or the input rate if lower). */
function analysisSignal(samples, sampleRate) {
  return sampleRate > PHONATION_ANALYSIS.rate * 1.5
    ? decimate(samples, sampleRate, PHONATION_ANALYSIS.rate)
    : { samples: Float64Array.from(samples), sampleRate };
}

/** Value at `fraction` of the sorted values (0 for none). */
function quantile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  ];
}

/**
 * Whether each frame (hop PHONATION_ANALYSIS.hop, window 2 hops centred
 * on it) is voiced: loud (RMS at least `levelShare` of the 95th
 * percentile) and low (at least `lowShare` of the power below 1 kHz, a
 * second-order low-pass). Frication and silence are not.
 */
function voicedFrames(signal, rate) {
  const hop = Math.round(PHONATION_ANALYSIS.hop * rate);
  const pole = Math.exp((-2 * Math.PI * 1000) / rate);
  const low = new Float64Array(signal.length);
  let first = 0;
  let second = 0;
  for (let index = 0; index < signal.length; index++) {
    first = (1 - pole) * signal[index] + pole * first;
    second = (1 - pole) * first + pole * second;
    low[index] = second;
  }
  const count = Math.floor(signal.length / hop);
  const levels = new Float64Array(count);
  const lows = new Float64Array(count);
  for (let frame = 0; frame < count; frame++) {
    const start = Math.max(0, frame * hop - hop / 2);
    const end = Math.min(signal.length, frame * hop + (3 * hop) / 2);
    let sum = 0;
    let lowSum = 0;
    for (let index = start; index < end; index++) {
      sum += signal[index] * signal[index];
      lowSum += low[index] * low[index];
    }
    levels[frame] = Math.sqrt(sum / Math.max(1, end - start));
    lows[frame] = sum > 0 ? lowSum / sum : 0;
  }
  const loud = quantile(levels, 0.95);
  const gate = Math.max(1e-5, PHONATION_ANALYSIS.levelShare * loud);
  return Array.from(
    levels,
    (level, frame) => level > gate && lows[frame] >= PHONATION_ANALYSIS.lowShare
  );
}

/** Hann window of `size` points. */
function hann(size) {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}

/** CPP (dB) of the frame of `length` samples from `start`. */
function frameCpp(signal, start, length, rate, window, size) {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let index = 0; index < length; index++) {
    re[index] = (signal[start + index] ?? 0) * window[index];
  }
  fft(re, im);
  for (let k = 0; k < size; k++) {
    re[k] = 10 * Math.log10(Math.max(FLOOR, re[k] * re[k] + im[k] * im[k]));
    im[k] = 0;
  }
  fft(re, im);
  const first = Math.ceil(rate / PHONATION_ANALYSIS.cppHigh);
  const last = Math.min(size / 2, Math.floor(rate / PHONATION_ANALYSIS.cppLow));
  const values = [];
  let sumX = 0;
  let sumY = 0;
  for (let q = first; q <= last; q++) {
    const magnitude = Math.hypot(re[q], im[q]) / size;
    const value = 20 * Math.log10(Math.max(1e-10, magnitude));
    values.push(value);
    sumX += q;
    sumY += value;
  }
  const n = values.length;
  const meanX = sumX / n;
  const meanY = sumY / n;
  let covariance = 0;
  let variance = 0;
  let peak = 0;
  for (let index = 0; index < n; index++) {
    const dx = first + index - meanX;
    covariance += dx * (values[index] - meanY);
    variance += dx * dx;
    if (values[index] > values[peak]) {
      peak = index;
    }
  }
  const slope = covariance / variance;
  const line = meanY + slope * (first + peak - meanX);
  return values[peak] - line;
}

/**
 * Cepstral peak prominence (dB): the real cepstrum (of the dB power
 * spectrum) of 40 ms Hann frames every 10 ms, its peak between quefrency
 * 1/300 and 1/60 s minus the regression line over that range, the median
 * over the voiced frames (loud and mostly below 1 kHz). A clear periodic
 * voice has a high peak; breath noise and aperiodic pulses lower it.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @returns {number} 0 without voiced frames
 */
export function cpp(samples, sampleRate) {
  const { samples: signal, sampleRate: rate } = analysisSignal(
    samples,
    sampleRate
  );
  const voiced = voicedFrames(signal, rate);
  const hop = Math.round(PHONATION_ANALYSIS.hop * rate);
  const length = Math.round(PHONATION_ANALYSIS.window * rate);
  const size = nextPowerOfTwo(length);
  const window = hann(length);
  const values = [];
  voiced.forEach((isVoiced, frame) => {
    const start = frame * hop + hop / 2 - length / 2;
    if (isVoiced && start >= 0 && start + length <= signal.length) {
      values.push(frameCpp(signal, start, length, rate, window, size));
    }
  });
  values.sort((a, b) => a - b);
  return values.length === 0 ? 0 : values[Math.floor(values.length / 2)];
}

/**
 * Prediction residual of the signal: LPC (order rate/1000 + 2) of 30 ms
 * Hann frames of the pre-emphasised signal every 10 ms, each inverse
 * filtering its 10 ms. Its peaks mark the glottal closures.
 */
function residual(signal, rate) {
  const emphasised = new Float64Array(signal.length);
  for (let index = 0; index < signal.length; index++) {
    emphasised[index] = signal[index] - 0.97 * (signal[index - 1] ?? 0);
  }
  const order = Math.round(rate / 1000) + 2;
  const hop = Math.round(PHONATION_ANALYSIS.hop * rate);
  const length = 3 * hop;
  const window = hann(length);
  const frame = new Float64Array(length);
  const output = new Float64Array(signal.length);
  for (let start = 0; start < signal.length; start += hop) {
    const from = start + hop / 2 - length / 2;
    for (let index = 0; index < length; index++) {
      frame[index] = (emphasised[from + index] ?? 0) * window[index];
    }
    const a = lpcCoefficients(frame, order);
    const end = Math.min(signal.length, start + hop);
    for (let index = start; index < end; index++) {
      let sum = 0;
      for (let k = 0; k <= order; k++) {
        sum += a[k] * (emphasised[index - k] ?? 0);
      }
      output[index] = sum;
    }
  }
  return output;
}

/**
 * Candidate glottal pulses of the voiced stretches: peaks of the energy of
 * the LPC residual (smoothed over 0.5 ms) that are the largest within the
 * shortest period (2 ms) and reach `pulseShare` of the largest within the
 * longest period (50 ms) around them. A train ends at an unvoiced frame
 * or a gap longer than the longest period.
 * @returns {number[][]} sample indices of the pulses of each train
 */
function pulseCandidates(signal, rate) {
  const voiced = voicedFrames(signal, rate);
  const hop = Math.round(PHONATION_ANALYSIS.hop * rate);
  const energy = residualEnergy(signal, rate);
  const near = Math.round(PHONATION_ANALYSIS.minPeriod * rate);
  const far = Math.round(PHONATION_ANALYSIS.maxPeriod * rate);
  const trains = [];
  let train = [];
  const close = () => {
    if (train.length > 1) {
      trains.push(train);
    }
    train = [];
  };
  for (let index = 1; index < signal.length - 1; index++) {
    if (!voiced[Math.floor(index / hop)]) {
      close();
    } else if (isPulse(energy, index, near, far)) {
      if (train.length > 0 && index - train.at(-1) > far) {
        close();
      }
      train.push(index);
    }
  }
  close();
  return trains;
}

/** Energy of the LPC residual, smoothed over 0.5 ms. */
function residualEnergy(signal, rate) {
  const error = residual(signal, rate);
  const smooth = Math.max(1, Math.round(0.00025 * rate));
  const energy = new Float64Array(signal.length);
  for (let index = 0; index < signal.length; index++) {
    let sum = 0;
    for (let k = -smooth; k <= smooth; k++) {
      const value = error[index + k] ?? 0;
      sum += value * value;
    }
    energy[index] = sum;
  }
  return energy;
}

/**
 * Whether the energy peaks at `index`: the largest within `near` samples
 * and at least `pulseShare` of the largest within `far` samples.
 */
function isPulse(energy, index, near, far) {
  const value = energy[index];
  if (value <= energy[index - 1] || value < energy[index + 1]) {
    return false;
  }
  let loudest = 0;
  for (let k = index - far; k <= index + far; k++) {
    const other = energy[k] ?? 0;
    if (Math.abs(k - index) <= near && other > value) {
      return false;
    }
    loudest = Math.max(loudest, other);
  }
  return value >= PHONATION_ANALYSIS.pulseShare * loudest;
}

/** Normalised cross-correlation of `length` samples at `a` and at `b`. */
function correlation(signal, a, b, length) {
  let product = 0;
  let first = 0;
  let second = 0;
  for (let index = 0; index < length; index++) {
    const x = signal[a + index] ?? 0;
    const y = signal[b + index] ?? 0;
    product += x * y;
    first += x * x;
    second += y * y;
  }
  return first > 0 && second > 0 ? product / Math.sqrt(first * second) : 0;
}

/**
 * The period (samples, sub-sample) that starts at pulse `from` with the
 * rough length `rough`: the lag within `rough` ± 15 % (at least 0.5 ms)
 * whose waveform best matches the one at `from` (normalised
 * cross-correlation over 0.8 of the period from a tenth before the pulse,
 * parabola through the best lag), and that match.
 */
function matchPeriod(signal, rate, from, rough) {
  const spread = Math.max(Math.round(0.0005 * rate), Math.round(0.15 * rough));
  const length = Math.max(4, Math.round(0.8 * rough));
  const start = from - Math.round(0.1 * rough);
  const low = Math.max(1, rough - spread);
  const high = rough + spread;
  const values = new Float64Array(high - low + 3);
  let best = low;
  for (let lag = low - 1; lag <= high + 1; lag++) {
    const value = correlation(signal, start, start + lag, length);
    values[lag - low + 1] = value;
    if (lag >= low && lag <= high && value > values[best - low + 1]) {
      best = lag;
    }
  }
  const before = values[best - low];
  const value = values[best - low + 1];
  const after = values[best - low + 2];
  const curvature = before - 2 * value + after;
  const offset = curvature < 0 ? (0.5 * (before - after)) / curvature : 0;
  return { period: best + Math.max(-0.5, Math.min(0.5, offset)), match: value };
}

/**
 * Glottal periods of the voiced stretches (issue 54). Candidate pulses are
 * the peaks of the LPC residual energy; each period between two
 * neighbouring candidates is refined to the lag whose waveform matches
 * best (as Praat's cross-correlation point process), and a period whose
 * waveform matches the next one by less than `PERIOD_MATCH` ends the
 * train (noise, a missed or an extra pulse). Down to 20 Hz.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @returns {{start: number, periods: number[]}[]} the trains of pulses:
 *   the time (s) of the first pulse and the periods (s)
 */
export function glottalPeriods(samples, sampleRate) {
  const { samples: signal, sampleRate: rate } = analysisSignal(
    samples,
    sampleRate
  );
  const result = [];
  for (const pulses of pulseCandidates(signal, rate)) {
    let train = null;
    for (let index = 1; index < pulses.length; index++) {
      const rough = pulses[index] - pulses[index - 1];
      const { period, match } = matchPeriod(
        signal,
        rate,
        pulses[index - 1],
        rough
      );
      if (match < PERIOD_MATCH) {
        train = null;
        continue;
      }
      if (!train) {
        train = { start: pulses[index - 1] / rate, periods: [] };
        result.push(train);
      }
      train.periods.push(period / rate);
    }
  }
  return result;
}

/** Waveform match two neighbouring periods need to stay in one train. */
export const PERIOD_MATCH = 0.8;

/**
 * Largest ratio of two neighbouring periods that jitter counts (Praat's
 * "maximum period factor", 1.3 there): above it one of them is a missed or
 * an extra pulse. 1.6 keeps the double pulsing of a creak (1.2 at 1) with
 * its jitter.
 */
export const MAX_PERIOD_FACTOR = 1.6;

/**
 * The periods of glottalPeriods() that start within `span` (seconds from
 * the start of `samples`; all without one), as runs of neighbours. The
 * pulses are found in the whole signal, so a short span such as one vowel
 * keeps the context of its neighbours.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, end?: number}} [span]
 * @returns {number[][]}
 */
export function periodRuns(samples, sampleRate, span = {}) {
  const from = span.start ?? -Infinity;
  const to = span.end ?? Infinity;
  const runs = [];
  for (const { start, periods } of glottalPeriods(samples, sampleRate)) {
    let time = start;
    let run = [];
    for (const period of periods) {
      if (time >= from && time < to) {
        run.push(period);
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      time += period;
    }
    if (run.length > 0) {
      runs.push(run);
    }
  }
  return runs;
}

/**
 * Jitter in percent: the mean absolute difference of neighbouring periods
 * divided by the mean period (local jitter, as Praat's "jitter (local)"),
 * over the pulse trains of glottalPeriods() (those within `span`, see
 * periodRuns()); pairs whose ratio exceeds MAX_PERIOD_FACTOR are left out.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, end?: number}} [span] seconds
 * @returns {number} 0 with fewer than two neighbouring periods
 */
export function jitterPercent(samples, sampleRate, span) {
  let differences = 0;
  let pairs = 0;
  let total = 0;
  let count = 0;
  for (const periods of periodRuns(samples, sampleRate, span)) {
    for (let index = 0; index < periods.length; index++) {
      total += periods[index];
      count++;
      const previous = periods[index - 1];
      const ratio = index > 0 ? periods[index] / previous : 0;
      if (
        ratio > 0 &&
        ratio <= MAX_PERIOD_FACTOR &&
        1 / ratio <= MAX_PERIOD_FACTOR
      ) {
        differences += Math.abs(periods[index] - previous);
        pairs++;
      }
    }
  }
  return pairs === 0 ? 0 : (100 * differences) / pairs / (total / count);
}

/**
 * f0 (Hz) of the glottal pulses: one over the median period, down to
 * 20 Hz (vocal fry, which the YIN pitch of analyzeVoice() misses).
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{start?: number, end?: number}} [span] seconds, see periodRuns()
 * @returns {number} 0 without periods
 */
export function pulseF0(samples, sampleRate, span) {
  const periods = periodRuns(samples, sampleRate, span).flat();
  const period = quantile(periods, 0.5);
  return period > 0 ? 1 / period : 0;
}

/** Hann-windowed DFT magnitude of `length` samples at `frequency`. */
function harmonicMagnitude(signal, start, length, frequency, rate) {
  const omega = (2 * Math.PI * frequency) / rate;
  let re = 0;
  let im = 0;
  for (let index = 0; index < length; index++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
    const value = (signal[start + index] ?? 0) * window;
    re += value * Math.cos(omega * index);
    im -= value * Math.sin(omega * index);
  }
  return Math.hypot(re, im);
}

/** Periods in each window of pulseH1H2(). */
export const H1H2_PERIODS = 4;

/**
 * H1-H2 (dB) of the glottal pulses: pitch-synchronous windows of
 * H1H2_PERIODS periods (glottalPeriods(), every second pulse), the level
 * of the harmonic at their mean f0 minus that at twice it, the median over
 * the windows. Unlike analyzeVoice() it follows a creaky voice below 60 Hz
 * (a double pulsing counts as two pulses, its subharmonic is left out).
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @returns {number} 0 without a window
 */
export function pulseH1H2(samples, sampleRate) {
  const { samples: signal, sampleRate: rate } = analysisSignal(
    samples,
    sampleRate
  );
  const values = [];
  for (const { start, periods } of glottalPeriods(signal, rate)) {
    let time = start;
    for (let index = 0; index + H1H2_PERIODS <= periods.length; index++) {
      if (index % 2 === 0) {
        let span = 0;
        for (let k = 0; k < H1H2_PERIODS; k++) {
          span += periods[index + k];
        }
        const f0 = H1H2_PERIODS / span;
        const from = Math.round(time * rate);
        const length = Math.round(span * rate);
        const h1 = harmonicMagnitude(signal, from, length, f0, rate);
        const h2 = harmonicMagnitude(signal, from, length, 2 * f0, rate);
        values.push(20 * Math.log10((h1 + 1e-12) / (h2 + 1e-12)));
      }
      time += periods[index];
    }
  }
  return quantile(values, 0.5);
}
