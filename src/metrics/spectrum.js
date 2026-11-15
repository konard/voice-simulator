/**
 * Short-time spectra for the objective speech metrics: a radix-2 Fourier
 * transform, Hann-windowed power frames, a mel filter bank and mel-frequency
 * cepstral coefficients (MFCC). Plain arithmetic, no dependency, no random
 * numbers, so every runtime gives the same values.
 */

/** Floor under powers and filter energies before a logarithm. */
export const EPSILON = 1e-10;

/** Next power of two that is not smaller than `value` (at least 1). */
export function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) {
    size *= 2;
  }
  return size;
}

/**
 * Common settings of the metrics: analysis rate (Hz), window and hop (s),
 * FFT size at the analysis rate, number of mel filters, highest cepstral
 * coefficient and the floor before logarithms.
 */
export const METRIC_DEFAULTS = Object.freeze({
  sampleRate: 16000,
  window: 0.025,
  hop: 0.01,
  fftSize: nextPowerOfTwo(Math.round(0.025 * 16000)),
  melFilters: 26,
  coefficients: 13,
  epsilon: EPSILON,
});

/** Twiddle factors and bit-reversal table per transform size. */
const FFT_TABLES = new Map();

function fftTables(size) {
  let tables = FFT_TABLES.get(size);
  if (!tables) {
    const cos = new Float64Array(size / 2);
    const sin = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / size);
      sin[k] = Math.sin((2 * Math.PI * k) / size);
    }
    const reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let index = 0; index < size; index++) {
      let value = 0;
      for (let bit = 0; bit < bits; bit++) {
        value |= ((index >> bit) & 1) << (bits - 1 - bit);
      }
      reversed[index] = value;
    }
    tables = { cos, sin, reversed };
    FFT_TABLES.set(size, tables);
  }
  return tables;
}

/**
 * In-place forward discrete Fourier transform X[k] = sum x[n] e^{-2 pi i k n / N}
 * (iterative radix-2 Cooley-Tukey).
 * @param {Float64Array} re Real parts; replaced by the real parts of X.
 * @param {Float64Array} im Imaginary parts; replaced by those of X.
 */
export function fft(re, im) {
  const size = re.length;
  if (im.length !== size) {
    throw new RangeError('fft: re and im must have the same length');
  }
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new RangeError(`fft: length ${size} is not a power of two`);
  }
  const { cos, sin, reversed } = fftTables(size);
  for (let index = 0; index < size; index++) {
    const other = reversed[index];
    if (other > index) {
      let swap = re[index];
      re[index] = re[other];
      re[other] = swap;
      swap = im[index];
      im[index] = im[other];
      im[other] = swap;
    }
  }
  for (let half = 1; half < size; half *= 2) {
    const step = size / (2 * half);
    for (let start = 0; start < size; start += 2 * half) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = -sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * Window length, hop (samples) and FFT size for a sample rate.
 * @param {number} sampleRate
 * @param {{window?: number, hop?: number, size?: number}} [options]
 */
export function frameSettings(sampleRate, options = {}) {
  const length = Math.max(
    1,
    Math.round((options.window ?? METRIC_DEFAULTS.window) * sampleRate)
  );
  const hop = Math.max(
    1,
    Math.round((options.hop ?? METRIC_DEFAULTS.hop) * sampleRate)
  );
  const size = options.size ?? nextPowerOfTwo(length);
  if (size < length) {
    throw new RangeError(`FFT size ${size} is shorter than the window`);
  }
  return { length, hop, size };
}

/**
 * Number of frames: every hop whose window fits in the signal, and at least
 * one (zero-padded) frame for a non-empty signal shorter than the window.
 */
export function frameCount(samples, length, hop) {
  if (samples.length === 0) {
    return 0;
  }
  if (samples.length < length) {
    return 1;
  }
  return Math.floor((samples.length - length) / hop) + 1;
}

const HANN = new Map();

function hann(length) {
  let window = HANN.get(length);
  if (!window) {
    window = new Float64Array(length);
    for (let index = 0; index < length; index++) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
    }
    HANN.set(length, window);
  }
  return window;
}

/**
 * Hann-windowed power spectra P[k] = re[k]^2 + im[k]^2, k = 0 .. size / 2.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{window?: number, hop?: number, size?: number}} [options]
 *   window and hop in seconds (default 0.025 and 0.01); size is the FFT
 *   length (default the next power of two of the window).
 * @returns {Float64Array[]}
 */
export function powerFrames(samples, sampleRate, options = {}) {
  const { length, hop, size } = frameSettings(sampleRate, options);
  const window = hann(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const count = frameCount(samples, length, hop);
  const frames = [];
  for (let frame = 0; frame < count; frame++) {
    re.fill(0);
    im.fill(0);
    const start = frame * hop;
    const end = Math.min(length, samples.length - start);
    for (let index = 0; index < end; index++) {
      re[index] = samples[start + index] * window[index];
    }
    fft(re, im);
    const power = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
    }
    frames.push(power);
  }
  return frames;
}

/** Mel scale: mel(f) = 2595 log10(1 + f / 700). */
export function hzToMel(frequency) {
  return 2595 * Math.log10(1 + frequency / 700);
}

/** Inverse of `hzToMel`. */
export function melToHz(mel) {
  return 700 * (10 ** (mel / 2595) - 1);
}

/**
 * Triangular mel filters over the bins 0 .. size / 2. The centres are
 * equally spaced on the mel scale between 0 Hz and sampleRate / 2 (the
 * `count + 2` points include both edges); filter m rises linearly from the
 * centre of filter m - 1 to 1 at its own centre and falls to 0 at the centre
 * of filter m + 1.
 * @param {number} count
 * @param {number} size FFT size.
 * @param {number} sampleRate
 * @returns {Float64Array[]} One weight per bin for each filter.
 */
export function melFilterbank(count, size, sampleRate) {
  const top = hzToMel(sampleRate / 2);
  const edges = Array.from({ length: count + 2 }, (_, index) =>
    melToHz((top * index) / (count + 1))
  );
  const filters = [];
  for (let m = 1; m <= count; m++) {
    const [left, centre, right] = [edges[m - 1], edges[m], edges[m + 1]];
    const weights = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) {
      const frequency = (k * sampleRate) / size;
      if (frequency > left && frequency <= centre) {
        weights[k] = (frequency - left) / (centre - left);
      } else if (frequency > centre && frequency < right) {
        weights[k] = (right - frequency) / (right - centre);
      }
    }
    filters.push(weights);
  }
  return filters;
}

const FILTERBANKS = new Map();

function cachedFilterbank(count, size, sampleRate) {
  const key = `${count}/${size}/${sampleRate}`;
  let filters = FILTERBANKS.get(key);
  if (!filters) {
    filters = melFilterbank(count, size, sampleRate);
    FILTERBANKS.set(key, filters);
  }
  return filters;
}

/**
 * MFCC of precomputed power frames (see `mfcc`).
 * @param {Float64Array[]} frames Output of `powerFrames`.
 * @param {number} sampleRate
 * @param {{filters?: number, coefficients?: number}} [options]
 * @returns {Float64Array[]}
 */
export function cepstra(frames, sampleRate, options = {}) {
  if (frames.length === 0) {
    return [];
  }
  const count = options.filters ?? METRIC_DEFAULTS.melFilters;
  const highest = options.coefficients ?? METRIC_DEFAULTS.coefficients;
  const size = (frames[0].length - 1) * 2;
  const filters = cachedFilterbank(count, size, sampleRate);
  const basis = [];
  for (let n = 0; n <= highest; n++) {
    const row = new Float64Array(count);
    for (let m = 1; m <= count; m++) {
      row[m - 1] =
        Math.sqrt(2 / count) * Math.cos((Math.PI * n * (m - 0.5)) / count);
    }
    basis.push(row);
  }
  const logEnergy = new Float64Array(count);
  return frames.map((power) => {
    filters.forEach((weights, m) => {
      let energy = 0;
      for (let k = 0; k < weights.length; k++) {
        energy += weights[k] * power[k];
      }
      logEnergy[m] = Math.log(Math.max(energy, EPSILON));
    });
    const coefficients = new Float64Array(highest + 1);
    basis.forEach((row, n) => {
      let sum = 0;
      for (let m = 0; m < count; m++) {
        sum += row[m] * logEnergy[m];
      }
      coefficients[n] = sum;
    });
    return coefficients;
  });
}

/**
 * Mel-frequency cepstral coefficients c[0] .. c[13] per frame: with E[m] the
 * energy of mel filter m (26 filters) and L[m] = ln(max(E[m], EPSILON)),
 * c[n] = sqrt(2 / M) sum_{m=1..M} L[m] cos(pi n (m - 0.5) / M).
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{window?: number, hop?: number, size?: number, filters?: number, coefficients?: number}} [options]
 * @returns {Float64Array[]}
 */
export function mfcc(samples, sampleRate, options = {}) {
  return cepstra(
    powerFrames(samples, sampleRate, options),
    sampleRate,
    options
  );
}
