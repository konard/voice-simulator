/**
 * Streaming analysis front end of the recognizer (issue 58).
 *
 * Sound becomes analysis frames, 200 per second by default (one per control
 * frame of the simulator, `CONTROL_RATE` in src/articulation/plan.js): energy,
 * zero crossings, spectral shape, periodicity, mel energies and cepstra,
 * linear prediction, a noise floor and a speech flag. The same code runs on a
 * whole recording (`analyzeFrames`) and on a live stream
 * (`createFrameAnalyzer`), so both give the same numbers. Every later
 * recognition stage reads these frames and nothing else computes spectra
 * again.
 *
 * Stage pattern of the later stages (issues 59 to 66): a stage is created
 * with `createX(frames, options)`, has `advance(final = false)`, which
 * processes the frames added since the last call, and an output object whose
 * arrays have `frames.capacity` rows and a field `committed` (rows before it
 * never change). After `frames` is trimmed a stage object is invalid; create
 * a new one.
 */

import { createResampler } from '../audio/resample.js';
import { createFft } from './fft.js';
import { lpcAutocorrelation, lpcBurg, lpcCovariance } from './lpc.js';

/**
 * Defaults. `rate: null` picks the largest of 8000, 11025 and 16000 Hz that
 * is not above the input rate; `order: null` means round(rate / 1000) + 2
 * (18 at 16000 Hz, 13 at 11025 Hz, 10 at 8000 Hz).
 */
export const FRONTEND_DEFAULTS = Object.freeze({
  rate: null,
  window: 0.025,
  hop: 0.005,
  preEmphasis: 0.97,
  lpc: 'burg',
  order: null,
  melBands: 24,
  cepstra: 13,
  maxSeconds: 30,
});

/** Working rates, highest first. */
const WORKING_RATES = [16000, 11025, 8000];
/** Hops (s) the later stages accept. */
const HOPS = [0.005, 0.01];
const LPC_METHODS = Object.freeze({
  burg: lpcBurg,
  autocorrelation: lpcAutocorrelation,
  covariance: lpcCovariance,
});
/** Floor under powers before a logarithm. */
const EPSILON = 1e-10;
/** Liu (1996) landmark bands (Hz). */
const BANDS = [
  [0, 400],
  [800, 1500],
  [1200, 2000],
  [2000, 3500],
  [3500, 5000],
  [5000, 8000],
];
/** Level of a band that lies above the Nyquist frequency (dB). */
const EMPTY_BAND = -100;
/** Spectral tilt: power in TILT_LOW over power in TILT_HIGH (Hz). */
const TILT_LOW = [50, 1000];
const TILT_HIGH = [1000, 3800];
/** Pitch range searched by `periodicity` (Hz). */
const PERIOD_MAX_F0 = 400;
const PERIOD_MIN_F0 = 70;
/** Mel filter bank edges (Hz). */
const MEL_LOW = 60;
const MEL_HIGH = 7600;
/** Minimum statistics (Martin 2001). */
const NOISE = Object.freeze({
  smoothing: 0.05, // s, time constant of the smoothed power
  block: 0.15, // s
  blocks: 10, // the minimum is taken over 10 blocks, 1.5 s
  bias: 1.5, // dB added to the minimum
  belowSpeech: 25, // dB, see `noiseFloor`
});
/** Speech flag: thresholds (dB above the noise floor) and hangover (s). */
const SPEECH = Object.freeze({
  strong: 9,
  weak: 4,
  periodicity: 0.6,
  hangover: 0.04,
});

/** Mel scale. */
function mel(frequency) {
  return 2595 * Math.log10(1 + frequency / 700);
}

function melToHz(value) {
  return 700 * (10 ** (value / 2595) - 1);
}

/**
 * Working rate for an input rate: `rate`, or else the largest of 8000,
 * 11025 and 16000 Hz that is not above `sampleRate`. Never up-samples.
 * @param {number} sampleRate
 * @param {number|null} [rate]
 * @returns {number}
 */
export function workingRate(sampleRate, rate = null) {
  if (!(sampleRate >= WORKING_RATES.at(-1))) {
    throw new RangeError(
      `sample rate ${sampleRate} Hz is below ${WORKING_RATES.at(-1)} Hz`
    );
  }
  if (rate === null || rate === undefined) {
    return WORKING_RATES.find((value) => value <= sampleRate);
  }
  if (!(rate >= WORKING_RATES.at(-1)) || rate > sampleRate) {
    throw new RangeError(
      `working rate ${rate} Hz must be from ${WORKING_RATES.at(-1)} Hz to the input rate ${sampleRate} Hz`
    );
  }
  return rate;
}

/** Throw a RangeError with `message` unless `ok`. */
function check(ok, message) {
  if (!ok) {
    throw new RangeError(message);
  }
}

/** Window length (samples) of `window` seconds; it must hold a hop. */
function windowLength(window, rate, hopSamples) {
  const length = Math.round(window * rate);
  check(
    length >= 4 && length <= 65536 && hopSamples <= length,
    `window ${window} s must hold 4 to 65536 samples and a hop`
  );
  return length;
}

/** Integer option of at least `min`. */
function integerOption(name, value, min, max = Infinity) {
  check(
    Number.isInteger(value) && value >= min && value <= max,
    `${name} must be an integer from ${min} to ${max}, got ${value}`
  );
  return value;
}

/** Settings of an analyzer: merged options, lengths and capacities. */
function frontendSettings(sampleRate, options) {
  const merged = { ...FRONTEND_DEFAULTS, ...options };
  const rate = workingRate(sampleRate, merged.rate);
  const hop = merged.hop;
  check(HOPS.includes(hop), `hop must be one of ${HOPS.join(', ')} s`);
  check(
    Object.hasOwn(LPC_METHODS, merged.lpc),
    `lpc must be one of ${Object.keys(LPC_METHODS).join(', ')}`
  );
  const hopSamples = hop * rate;
  const length = windowLength(merged.window, rate, hopSamples);
  const order = integerOption(
    'order',
    merged.order ?? Math.round(rate / 1000) + 2,
    1,
    length - 1
  );
  const preEmphasis = merged.preEmphasis;
  check(
    preEmphasis >= 0 && preEmphasis < 1,
    `preEmphasis must be in [0, 1), got ${preEmphasis}`
  );
  const maxSeconds = merged.maxSeconds;
  check(
    maxSeconds >= 0 && Number.isFinite(maxSeconds),
    'maxSeconds must be finite and >= 0'
  );
  let size = 2;
  while (size < length) {
    size *= 2;
  }
  return {
    rate,
    hop,
    window: merged.window,
    length,
    half: Math.floor(length / 2),
    hopSamples,
    size,
    order,
    melBands: integerOption('melBands', merged.melBands, 1),
    cepstra: integerOption('cepstra', merged.cepstra, 1),
    preEmphasis,
    method: LPC_METHODS[merged.lpc],
    maxSeconds,
    capacity: Math.ceil(maxSeconds / hop),
    sampleCapacity: Math.ceil(maxSeconds * rate),
  };
}

/** Bins k with low <= k rate / size < high, the Nyquist bin at the top. */
function binRange(low, high, rate, size) {
  const nyquist = rate / 2;
  if (low >= nyquist) {
    return null;
  }
  const first = Math.max(0, Math.ceil((low * size) / rate));
  const last = high >= nyquist ? size / 2 : Math.ceil((high * size) / rate) - 1;
  return [first, last];
}

/** Constant tables of one setting: window, filters, ranges. */
function frontendTables(settings) {
  const { length, size, rate, melBands, cepstra, preEmphasis } = settings;
  const half = size / 2;
  const hann = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
  }
  const fft = createFft(size);
  // Autocorrelation of the window by the same transform, w[0] = 1.
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(hann);
  fft.forward(re, im);
  for (let k = 0; k < size; k++) {
    re[k] = re[k] * re[k] + im[k] * im[k];
    im[k] = 0;
  }
  fft.inverse(re, im);
  const lagMin = Math.max(1, Math.ceil(rate / PERIOD_MAX_F0));
  const lagMax = Math.min(half, Math.floor(rate / PERIOD_MIN_F0));
  const windowCorrelation = new Float64Array(lagMax + 1);
  for (let lag = 0; lag <= lagMax; lag++) {
    windowCorrelation[lag] = re[lag] / re[0];
  }
  // Mel filters times the pre-emphasis gain G[k], stored sparse.
  const top = mel(Math.min(rate / 2, MEL_HIGH));
  const bottom = mel(MEL_LOW);
  const edges = Array.from({ length: melBands + 2 }, (_, index) =>
    melToHz(bottom + ((top - bottom) * index) / (melBands + 1))
  );
  const melFirst = new Int32Array(melBands);
  const melLast = new Int32Array(melBands);
  const weights = [];
  for (let m = 0; m < melBands; m++) {
    const [left, centre, right] = [edges[m], edges[m + 1], edges[m + 2]];
    melFirst[m] = -1;
    for (let k = 0; k <= half; k++) {
      const frequency = (k * rate) / size;
      let weight = 0;
      if (frequency > left && frequency <= centre) {
        weight = (frequency - left) / (centre - left);
      } else if (frequency > centre && frequency < right) {
        weight = (right - frequency) / (right - centre);
      }
      if (weight > 0) {
        if (melFirst[m] < 0) {
          melFirst[m] = k;
        }
        melLast[m] = k;
        const gain =
          1 +
          preEmphasis * preEmphasis -
          2 * preEmphasis * Math.cos((2 * Math.PI * k) / size);
        weights.push(weight * gain);
      }
    }
    if (melFirst[m] < 0) {
      melFirst[m] = 0;
      melLast[m] = -1;
    }
  }
  const dct = new Float64Array(cepstra * melBands);
  for (let n = 0; n < cepstra; n++) {
    for (let m = 1; m <= melBands; m++) {
      dct[n * melBands + m - 1] =
        Math.sqrt(2 / melBands) *
        Math.cos((Math.PI * n * (m - 0.5)) / melBands);
    }
  }
  return {
    hann,
    fft,
    lagMin,
    lagMax,
    windowCorrelation,
    melFirst,
    melLast,
    melWeights: Float64Array.from(weights),
    dct,
    bands: BANDS.map(([low, high]) => binRange(low, high, rate, size)),
    tiltLow: binRange(TILT_LOW[0], TILT_LOW[1], rate, size),
    tiltHigh: binRange(TILT_HIGH[0], TILT_HIGH[1], rate, size),
  };
}

/** Sum of power[first .. last]. */
function rangePower(power, range) {
  let sum = 0;
  for (let k = range[0]; k <= range[1]; k++) {
    sum += power[k];
  }
  return sum;
}

/** Empty frame set of `settings.capacity` rows. */
function createFrameSet(settings, samples, storage) {
  const rows = settings.capacity;
  const column = (key, width = 1, Type = Float32Array) =>
    storage?.(key, rows * width, Type) ?? new Type(rows * width);
  return {
    rate: settings.rate,
    hop: settings.hop,
    window: settings.window,
    size: settings.size,
    order: settings.order,
    melBands: settings.melBands,
    cepstra: settings.cepstra,
    capacity: rows,
    count: 0,
    startTime: 0,
    samples,
    sampleCount: 0,
    energy: column('energy'),
    zcr: column('zcr'),
    tilt: column('tilt'),
    gravity: column('gravity'),
    periodicity: column('periodicity'),
    noise: column('noise'),
    gain: column('gain'),
    speech: column('speech', 1, Uint8Array),
    lpc: column('lpc', settings.order),
    reflection: column('reflection', settings.order),
    mel: column('mel', settings.melBands),
    cepstrum: column('cepstrum', settings.cepstra),
    band: column('band', BANDS.length),
  };
}

/** Arrays of a frame set with their row widths. */
function frameColumns(frames) {
  return [
    [frames.energy, 1],
    [frames.zcr, 1],
    [frames.tilt, 1],
    [frames.gravity, 1],
    [frames.periodicity, 1],
    [frames.noise, 1],
    [frames.gain, 1],
    [frames.speech, 1],
    [frames.lpc, frames.order],
    [frames.reflection, frames.order],
    [frames.mel, frames.melBands],
    [frames.cepstrum, frames.cepstra],
    [frames.band, BANDS.length],
  ];
}

/**
 * Noise floor by minimum statistics (Martin 2001) and the speech flag, one
 * frame at a time. The smoothed power s[t] = g s[t-1] + (1 - g) p[t],
 * g = exp(-hop / 0.05), is tracked by its minimum over ten blocks of 0.15 s
 * (the running block and the nine before it); the floor is that minimum in
 * dB plus 1.5 dB, but never above the loudest frame already flagged as
 * speech by the 9 dB rule minus 25 dB, so a stretch of speech longer than
 * 1.5 s without a pause does not raise the floor into the speech.
 */
function createNoiseTracker(hop) {
  const smoothing = Math.exp(-hop / NOISE.smoothing);
  const blockLength = Math.max(1, Math.round(NOISE.block / hop));
  const previous = new Float64Array(NOISE.blocks - 1);
  const hangover = Math.round(SPEECH.hangover / hop);
  const state = {};
  function reset() {
    state.started = false;
    state.smoothed = 0;
    state.blockMin = Infinity;
    state.blockFill = 0;
    state.slot = 0;
    state.speechPeak = -Infinity;
    state.hang = 0;
    previous.fill(Infinity);
  }
  reset();
  return {
    reset,
    /** Floor (dB) after a frame of mean power `power` (linear). */
    noiseFloor(power) {
      state.smoothed = state.started
        ? smoothing * state.smoothed + (1 - smoothing) * power
        : power;
      state.started = true;
      state.blockMin = Math.min(state.blockMin, state.smoothed);
      let minimum = state.blockMin;
      for (let index = 0; index < previous.length; index++) {
        minimum = Math.min(minimum, previous[index]);
      }
      state.blockFill++;
      if (state.blockFill === blockLength) {
        previous[state.slot] = state.blockMin;
        state.slot = (state.slot + 1) % previous.length;
        state.blockMin = Infinity;
        state.blockFill = 0;
      }
      const floor = 10 * Math.log10(minimum) + NOISE.bias;
      // No cap before the first speech frame (speechPeak is -Infinity).
      return state.speechPeak > -Infinity
        ? Math.min(floor, state.speechPeak - NOISE.belowSpeech)
        : floor;
    },
    /** Speech flag of a frame with its energy, floor and periodicity. */
    speech(energy, noise, periodicity) {
      const above = energy - noise;
      if (above >= SPEECH.strong) {
        state.speechPeak = Math.max(state.speechPeak, energy);
      }
      if (
        above >= SPEECH.strong ||
        (above >= SPEECH.weak && periodicity >= SPEECH.periodicity)
      ) {
        state.hang = hangover;
        return 1;
      }
      if (state.hang > 0) {
        state.hang--;
        return 1;
      }
      return 0;
    },
  };
}

/** Scratch memory and tables of the per-frame analysis. */
function createKernel(settings, tables, frames) {
  const { length, size, order, melBands } = settings;
  return {
    settings,
    tables,
    frames,
    raw: new Float64Array(length),
    emphasised: new Float64Array(length),
    re: new Float64Array(size),
    im: new Float64Array(size),
    power: new Float64Array(size / 2 + 1),
    a: new Float64Array(order),
    k: new Float64Array(order),
    logMel: new Float64Array(melBands),
  };
}

/**
 * Energy and zero crossings of the raw frame at `buffer[start]`; fills the
 * windowed frame for the transform and the pre-emphasised windowed frame
 * for LPC. Returns the mean power (plus EPSILON).
 */
function measureWaveform(kernel, row, buffer, start) {
  const { raw, emphasised, re, im, frames } = kernel;
  const { length, preEmphasis } = kernel.settings;
  const hann = kernel.tables.hann;
  let sum = 0;
  let crossings = 0;
  let previous = buffer[start - 1];
  for (let n = 0; n < length; n++) {
    const value = buffer[start + n];
    raw[n] = value;
    sum += value * value;
    if (n > 0 && value >= 0 !== raw[n - 1] >= 0) {
      crossings++;
    }
    emphasised[n] = (value - preEmphasis * previous) * hann[n];
    previous = value;
    re[n] = value * hann[n];
    im[n] = 0;
  }
  re.fill(0, length);
  im.fill(0, length);
  const meanPower = sum / length + EPSILON;
  frames.energy[row] = 10 * Math.log10(meanPower);
  frames.zcr[row] = crossings / (length - 1);
  return meanPower;
}

/** Power spectrum, centre of gravity, tilt and the six bands. */
function measureSpectrum(kernel, row) {
  const { re, im, power, frames, tables } = kernel;
  const { size, rate } = kernel.settings;
  tables.fft.forward(re, im);
  let total = 0;
  let moment = 0;
  for (let bin = 0; bin <= size / 2; bin++) {
    const value = re[bin] * re[bin] + im[bin] * im[bin];
    power[bin] = value;
    total += bin > 0 ? value : 0;
    moment += ((bin * rate) / size) * value;
  }
  frames.gravity[row] = total > 0 ? moment / total : 0;
  frames.tilt[row] =
    10 *
    Math.log10(
      (rangePower(power, tables.tiltLow) + EPSILON) /
        (rangePower(power, tables.tiltHigh) + EPSILON)
    );
  const bands = tables.bands;
  for (let band = 0; band < bands.length; band++) {
    frames.band[row * bands.length + band] = bands[band]
      ? 10 * Math.log10(rangePower(power, bands[band]) + EPSILON)
      : EMPTY_BAND;
  }
}

/**
 * Periodicity (Boersma 1993): the autocorrelation r is the inverse
 * transform of the power spectrum; the largest r[l] / (r[0] w[l]) over the
 * pitch lags, limited to 0 .. 1.
 */
function measurePeriodicity(kernel, row) {
  const { re, im, power, frames } = kernel;
  const { lagMin, lagMax, windowCorrelation, fft } = kernel.tables;
  const size = kernel.settings.size;
  for (let bin = 0; bin < size; bin++) {
    re[bin] = power[bin <= size / 2 ? bin : size - bin];
    im[bin] = 0;
  }
  fft.inverse(re, im);
  let periodicity = 0;
  if (re[0] > 0) {
    for (let lag = lagMin; lag <= lagMax; lag++) {
      periodicity = Math.max(
        periodicity,
        re[lag] / (re[0] * windowCorrelation[lag])
      );
    }
  }
  periodicity = Math.min(1, periodicity);
  frames.periodicity[row] = periodicity;
  return periodicity;
}

/** Mel energies of the pre-emphasised spectrum and their cepstrum. */
function measureMel(kernel, row) {
  const { power, logMel, frames } = kernel;
  const { melFirst, melLast, melWeights, dct } = kernel.tables;
  const { melBands, cepstra } = kernel.settings;
  let weight = 0;
  for (let m = 0; m < melBands; m++) {
    let sum = 0;
    for (let bin = melFirst[m]; bin <= melLast[m]; bin++, weight++) {
      sum += melWeights[weight] * power[bin];
    }
    logMel[m] = Math.log(Math.max(sum, EPSILON));
    frames.mel[row * melBands + m] = logMel[m];
  }
  for (let n = 0; n < cepstra; n++) {
    let value = 0;
    for (let m = 0; m < melBands; m++) {
      value += dct[n * melBands + m] * logMel[m];
    }
    frames.cepstrum[row * cepstra + n] = value;
  }
}

/** Linear prediction of the pre-emphasised windowed frame. */
function measureLpc(kernel, row) {
  const { emphasised, a, k, frames } = kernel;
  const { order, method } = kernel.settings;
  const residual = method(emphasised, order, a, k);
  for (let i = 0; i < order; i++) {
    frames.lpc[row * order + i] = a[i];
    frames.reflection[row * order + i] = k[i];
  }
  frames.gain[row] = 10 * Math.log10(residual + EPSILON);
}

/**
 * Streaming analyzer: sound in, analysis frames out.
 *
 * `push(chunk)` takes samples at `sampleRate` (any length) and returns how
 * many frames it added; frame t, centred on working sample
 * c = round(t hop rate) and covering samples c - N/2 .. c + N/2 - 1 (zeros
 * outside the signal), is added as soon as its last sample has arrived.
 * `flush()` ends the stream: it adds the frames that need zeros at the end
 * (`count` becomes floor((sampleCount - 1) / (hop rate)) + 1) and returns
 * how many it added; `push` after `flush` throws until `reset()`.
 * `trim(n)` drops the first n frames and their samples, moves the rest to
 * the front and adds n hop to `startTime`; the noise floor keeps its state.
 * `push` throws a RangeError when the samples would not fit in `maxSeconds`.
 * No memory is allocated per frame.
 * @param {number} sampleRate Input rate (Hz), at least 8000.
 * @param {Partial<typeof FRONTEND_DEFAULTS>} [options]
 */
export function createFrameAnalyzer(sampleRate, options = {}) {
  return frameAnalyzer(sampleRate, options);
}

function frameAnalyzer(sampleRate, options, onFrame, storage) {
  const settings = frontendSettings(sampleRate, options);
  const tables = frontendTables(settings);
  const { rate, length, half, hopSamples, capacity, sampleCapacity } = settings;
  // The buffer holds `margin` samples before `samples[0]` (zeros before the
  // signal, the trimmed past after `trim`) and `length` zeros after the
  // last place a sample can go.
  const margin = half + 1;
  const size = margin + sampleCapacity + length + 1;
  const buffer =
    storage?.('samples', size, Float32Array) ?? new Float32Array(size);
  const frames = createFrameSet(
    settings,
    buffer.subarray(margin, margin + sampleCapacity),
    storage
  );
  const columns = frameColumns(frames);
  const noiseTracker = createNoiseTracker(settings.hop);
  const kernel = createKernel(settings, tables, frames);
  const ratio = rate / sampleRate;
  let resampler = null;
  // Absolute positions since the last reset: `offset` frames and `base`
  // working samples were trimmed, `end` working samples arrived, `received`
  // input samples were pushed.
  let offset = 0;
  let base = 0;
  let end = 0;
  let received = 0;
  let flushed = false;

  const centre = (frame) => Math.round(frame * hopSamples);

  function reset() {
    resampler = rate === sampleRate ? null : createResampler(sampleRate, rate);
    buffer.fill(0);
    for (const [array] of columns) {
      array.fill(0);
    }
    noiseTracker.reset();
    offset = 0;
    base = 0;
    end = 0;
    received = 0;
    flushed = false;
    frames.count = 0;
    frames.startTime = 0;
    frames.sampleCount = 0;
  }

  function append(values) {
    let index = margin + end - base;
    for (let n = 0; n < values.length; n++, index++) {
      if (index >= 0) {
        buffer[index] = values[n];
      }
    }
    end += values.length;
    frames.sampleCount = Math.max(0, end - base);
  }

  /** Analyse frame `row` (relative to the trimmed start) into its rows. */
  function analyse(row) {
    const start = margin + centre(offset + row) - half - base;
    const meanPower = measureWaveform(kernel, row, buffer, start);
    measureSpectrum(kernel, row);
    measureMel(kernel, row);
    const periodicity = measurePeriodicity(kernel, row);
    measureLpc(kernel, row);
    const noise = noiseTracker.noiseFloor(meanPower);
    frames.noise[row] = noise;
    frames.speech[row] = noiseTracker.speech(
      frames.energy[row],
      noise,
      periodicity
    );
    onFrame?.(frames, row, meanPower, periodicity);
  }

  /** Add the frames before absolute frame `lastFrame`. */
  function addFrames(lastFrame) {
    let added = 0;
    while (offset + frames.count < lastFrame) {
      if (frames.count >= capacity) {
        throw new RangeError(`frame set is full (${capacity} frames)`);
      }
      analyse(frames.count);
      frames.count++;
      added++;
    }
    return added;
  }

  /** Frames whose last sample has arrived (absolute count). */
  function readyFrames() {
    // centre(t) - half + length - 1 < end
    let frame = offset + frames.count;
    while (centre(frame) - half + length - 1 < end) {
      frame++;
    }
    return frame;
  }

  reset();

  return {
    frames,
    /**
     * Add samples at the input rate; returns the number of frames added.
     * @param {ArrayLike<number>} chunk
     */
    push(chunk) {
      if (flushed) {
        throw new Error('push after flush: call reset() first');
      }
      const total = received + chunk.length;
      const projected = resampler ? Math.round(total * ratio) : total;
      if (projected - base > sampleCapacity) {
        throw new RangeError(
          `frame set is full (${settings.maxSeconds} s at ${rate} Hz)`
        );
      }
      received = total;
      append(resampler ? resampler.push(chunk) : chunk);
      return addFrames(readyFrames());
    },
    /** End of the stream: add the frames that need zeros at the end. */
    flush() {
      if (!flushed && resampler) {
        append(resampler.flush());
      }
      flushed = true;
      const last = end > 0 ? Math.floor((end - 1) / hopSamples) + 1 : 0;
      return addFrames(last);
    },
    /**
     * Drop the first `count` frames and their samples.
     * @param {number} count
     */
    trim(count) {
      if (!Number.isInteger(count) || count < 0 || count > frames.count) {
        throw new RangeError(
          `trim: ${count} is not a frame count from 0 to ${frames.count}`
        );
      }
      if (count === 0) {
        return;
      }
      for (const [array, width] of columns) {
        array.copyWithin(0, count * width, frames.count * width);
        array.fill(0, (frames.count - count) * width, frames.count * width);
      }
      const newBase = centre(offset + count);
      const shift = newBase - base;
      const dirty = margin + Math.max(0, end - base);
      buffer.copyWithin(0, Math.min(shift, dirty), dirty);
      buffer.fill(0, Math.max(0, dirty - shift), dirty);
      base = newBase;
      offset += count;
      frames.count -= count;
      frames.startTime += count * settings.hop;
      frames.sampleCount = Math.max(0, end - base);
    },
    /** Forget everything: an empty frame set at time 0. */
    reset,
  };
}

/**
 * Analysis frames of a whole recording: an analyzer with `maxSeconds` set to
 * the length of the input, one `push` and `flush()`.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {Partial<typeof FRONTEND_DEFAULTS>} [options]
 */
export function analyzeFrames(samples, sampleRate, options = {}, storage) {
  const analyzer = frameAnalyzer(
    sampleRate,
    { ...options, maxSeconds: samples.length / sampleRate },
    undefined,
    storage
  );
  analyzer.push(samples);
  analyzer.flush();
  return analyzer.frames;
}

/** Share the per-window features of the default 5 ms and 10 ms batch grids. */
export function analyzeFrameHops(samples, sampleRate) {
  const maxSeconds = samples.length / sampleRate;
  const fast = { maxSeconds };
  const slow = frontendSettings(sampleRate, { maxSeconds, hop: 0.01 });
  const coarse = createFrameSet(slow, null);
  const noiseTracker = createNoiseTracker(slow.hop);
  const coarseColumns = frameColumns(coarse);
  let fineColumns;
  const analyzer = frameAnalyzer(
    sampleRate,
    fast,
    (frames, row, power, period) => {
      if (row % 2 !== 0 || coarse.count >= coarse.capacity) {
        return;
      }
      fineColumns ??= frameColumns(frames);
      const target = coarse.count++;
      for (let i = 0; i < coarseColumns.length; i++) {
        const [column, width] = coarseColumns[i];
        const [source] = fineColumns[i];
        for (let j = 0; j < width; j++) {
          column[target * width + j] = source[row * width + j];
        }
      }
      // The coarse grid's noise history is independent of the fine grid's.
      const noise = noiseTracker.noiseFloor(power);
      coarse.noise[target] = noise;
      coarse.speech[target] = noiseTracker.speech(
        coarse.energy[target],
        noise,
        period
      );
    }
  );
  analyzer.push(samples);
  analyzer.flush();
  const fine = analyzer.frames;
  coarse.samples = fine.samples;
  coarse.sampleCount = fine.sampleCount;
  return { fine, coarse };
}
