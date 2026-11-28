/**
 * Band-limited sample-rate conversion (Blackman-windowed sinc).
 *
 * Accurate enough to convert recordings for matching or to export at a
 * player's preferred rate; the error on a mid-band tone is below -60 dB.
 */

function blackman(x) {
  return 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
}

function sinc(x) {
  if (x === 0) {
    return 1;
  }
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

/** Integer-aligned outputs share the same filter around their centers. */
function integerKernel(cutoff, halfWidth) {
  // Adding a large integer center can round a near-integer bound outward.
  const radius = Math.ceil(halfWidth);
  const length = 2 * radius + 1;
  const lobes = new Float64Array(length);
  const window = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const distance = radius - i;
    lobes[i] = sinc(cutoff * distance);
    window[i] = blackman(distance / halfWidth);
  }
  return { radius, lobes, window };
}

function resampleAt(samples, center, cutoff, halfWidth, kernel) {
  const first = Math.max(0, Math.ceil(center - halfWidth));
  const last = Math.min(samples.length - 1, Math.floor(center + halfWidth));
  let sum = 0;
  if (kernel && Number.isInteger(center)) {
    const { radius, lobes, window } = kernel;
    for (let source = first; source <= last; source++) {
      const offset = source - center + radius;
      sum += samples[source] * cutoff * lobes[offset] * window[offset];
    }
  } else {
    for (let source = first; source <= last; source++) {
      const distance = center - source;
      sum +=
        samples[source] *
        cutoff *
        sinc(cutoff * distance) *
        blackman(distance / halfWidth);
    }
  }
  return sum;
}

/**
 * Resample mono samples to another rate.
 * @param {ArrayLike<number>} samples
 * @param {number} fromRate
 * @param {number} toRate
 * @param {{zeroCrossings?: number}} [options] Filter half-length in zero
 *   crossings of the low-pass (default 16; more is sharper and slower).
 * @returns {Float32Array}
 */
export function resample(samples, fromRate, toRate, options = {}) {
  return resampleWithStorage(
    samples,
    fromRate,
    toRate,
    (length) => new Float32Array(length),
    options
  );
}

/** Rate conversion with caller-owned output when the rates differ. */
export function resampleWithStorage(
  samples,
  fromRate,
  toRate,
  storage,
  options = {}
) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new Error('Sample rates must be positive');
  }
  if (fromRate === toRate) {
    return Float32Array.from(samples);
  }
  const ratio = toRate / fromRate;
  // Keep a small guard band below the lower Nyquist frequency.
  const cutoff = Math.min(1, ratio) * 0.97;
  const halfWidth = (options.zeroCrossings ?? 16) / cutoff;
  const length = Math.round(samples.length * ratio);
  const result = storage(length);
  const kernel =
    Number.isInteger(fromRate / toRate) && halfWidth > 0 && halfWidth <= 256
      ? integerKernel(cutoff, halfWidth)
      : null;
  for (let index = 0; index < length; index++) {
    result[index] = resampleAt(
      samples,
      index / ratio,
      cutoff,
      halfWidth,
      kernel
    );
  }
  return result;
}

/**
 * Streaming form of `resample`: the same kernel, fed one chunk at a time.
 *
 * `push(chunk)` returns every output sample whose whole filter window has
 * arrived, `flush()` the rest (missing input counts as 0). Joined, the
 * outputs are `resample(all, fromRate, toRate, {zeroCrossings})` of the
 * whole input, `Math.round(total * toRate / fromRate)` samples, computed
 * with the same operations in the same order. Only the input samples that a
 * later output still needs are kept. With equal rates both return copies.
 * @param {number} fromRate
 * @param {number} toRate
 * @param {{zeroCrossings?: number}} [options] Default 8 (`resample` uses 16).
 * @returns {{push: (chunk: ArrayLike<number>) => Float32Array, flush: () => Float32Array}}
 */
export function createStreamResampler(fromRate, toRate, options = {}) {
  return streamResampler(fromRate, toRate, options.zeroCrossings ?? 8, false);
}

/** Greatest common divisor of two positive integers. */
function gcd(a, b) {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Largest kernel table (values) that `createResampler` builds. */
const MAX_TABLE = 1 << 20;

/**
 * Kernel values by phase when both rates are integers: output `index` sits
 * at input position q + p / L (L = toRate / gcd, p = index fromRate mod L),
 * so its weights depend on p only. Returns null when the table would be too
 * large.
 */
function kernelTable(fromRate, toRate, cutoff, halfWidth) {
  if (!Number.isInteger(fromRate) || !Number.isInteger(toRate)) {
    return null;
  }
  const divisor = gcd(fromRate, toRate);
  const phases = toRate / divisor;
  const step = fromRate / divisor;
  const width = 2 * Math.ceil(halfWidth) + 2;
  if (phases * width > MAX_TABLE) {
    return null;
  }
  const first = new Int32Array(phases);
  const last = new Int32Array(phases);
  const weights = new Float64Array(phases * width);
  for (let phase = 0; phase < phases; phase++) {
    const fraction = phase / phases;
    first[phase] = Math.ceil(fraction - halfWidth);
    last[phase] = Math.floor(fraction + halfWidth);
    for (let offset = first[phase]; offset <= last[phase]; offset++) {
      const distance = fraction - offset;
      weights[phase * width + offset - first[phase]] =
        cutoff * sinc(cutoff * distance) * blackman(distance / halfWidth);
    }
  }
  return { phases, step, width, first, last, weights };
}

function streamingKernel(fromRate, toRate, zeroCrossings, tabulated) {
  const ratio = toRate / fromRate;
  const cutoff = Math.min(1, ratio) * 0.97;
  const halfWidth = zeroCrossings / cutoff;
  const table = tabulated
    ? kernelTable(fromRate, toRate, cutoff, halfWidth)
    : null;
  return { ratio, cutoff, halfWidth, table };
}

/** One output using the same arithmetic for batch and streaming analysis. */
function streamingSample(samples, base, limit, index, kernel) {
  const { ratio, cutoff, halfWidth, table } = kernel;
  if (table) {
    const { phases, step, width, first, last, weights } = table;
    const position = index * step;
    const phase = position % phases;
    const whole = (position - phase) / phases;
    const start = whole + first[phase];
    const from = Math.max(0, start);
    const to = Math.min(limit - 1, whole + last[phase]);
    const row = phase * width - start;
    let sum = 0;
    for (let source = from; source <= to; source++) {
      sum += samples[source - base] * weights[row + source];
    }
    return sum;
  }
  const center = index / ratio;
  const from = Math.max(0, Math.ceil(center - halfWidth));
  const to = Math.min(limit - 1, Math.floor(center + halfWidth));
  let sum = 0;
  for (let source = from; source <= to; source++) {
    const distance = center - source;
    sum +=
      samples[source - base] *
      cutoff *
      sinc(cutoff * distance) *
      blackman(distance / halfWidth);
  }
  return sum;
}

/** Fill the final analysis buffer directly using `createResampler`'s kernel. */
export function resampleAnalysisBuffer(samples, fromRate, toRate, output) {
  const kernel = streamingKernel(fromRate, toRate, 16, true);
  const length = Math.round(samples.length * kernel.ratio);
  if (length > output.length) {
    throw new RangeError('Analysis buffer is too short for the recording');
  }
  for (let index = 0; index < length; index++) {
    output[index] = streamingSample(samples, 0, samples.length, index, kernel);
  }
  return length;
}

function streamResampler(fromRate, toRate, zeroCrossings, tabulated) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new Error('Sample rates must be positive');
  }
  if (fromRate === toRate) {
    return {
      push: (chunk) => Float32Array.from(chunk),
      flush: () => new Float32Array(0),
      held: () => 0,
    };
  }
  const kernel = streamingKernel(fromRate, toRate, zeroCrossings, tabulated);
  const { ratio, halfWidth } = kernel;
  // Kept input: samples `base` .. `base + count - 1` of the whole stream.
  let kept = new Float64Array(64);
  let base = 0;
  let count = 0;
  // Total input so far and the index of the next output sample.
  let received = 0;
  let next = 0;

  function append(chunk) {
    const length = chunk.length;
    if (count + length > kept.length) {
      const grown = new Float64Array(Math.max(kept.length * 2, count + length));
      grown.set(kept.subarray(0, count));
      kept = grown;
    }
    kept.set(chunk, count);
    count += length;
    received += length;
  }

  /** Drop the input that no output from `next` on needs. */
  function trim() {
    const needed = Math.max(0, Math.ceil(next / ratio - halfWidth));
    const drop = Math.min(count, needed - base);
    if (drop > 0) {
      kept.copyWithin(0, drop, count);
      base += drop;
      count -= drop;
    }
  }

  return {
    push(chunk) {
      append(chunk);
      // An output is ready when the last input of its window has arrived.
      let end = next;
      while (Math.floor(end / ratio + halfWidth) < received) {
        end++;
      }
      const result = new Float32Array(end - next);
      for (let index = 0; index < result.length; index++) {
        result[index] = streamingSample(
          kept,
          base,
          received,
          next + index,
          kernel
        );
      }
      next = end;
      trim();
      return result;
    },
    flush() {
      const length = Math.round(received * ratio);
      const result = new Float32Array(Math.max(0, length - next));
      for (let index = 0; index < result.length; index++) {
        result[index] = streamingSample(
          kept,
          base,
          received,
          next + index,
          kernel
        );
      }
      next += result.length;
      trim();
      return result;
    },
    /** Input samples held for the outputs still to come. */
    held: () => count,
  };
}

/**
 * Chunk-by-chunk `resample` (issue 58): the kernel and the default
 * `zeroCrossings` (16) of `resample`, so the joined outputs of `push(chunk)`
 * and `flush()` equal `resample(all, fromRate, toRate, options)` of the
 * joined input within 1e-6 (with integer rates the kernel values come from
 * a table per output phase, built once, which differs from the direct
 * values only by rounding: 3e-8 for 44100 to 16000 Hz in
 * experiments/issue-58-resampler.mjs). It keeps about `zeroCrossings / min(1, toRate / fromRate)`
 * input samples, the half-length of the filter.
 * @param {number} fromRate
 * @param {number} toRate
 * @param {{zeroCrossings?: number}} [options]
 * @returns {{push: (chunk: ArrayLike<number>) => Float32Array, flush: () => Float32Array, held: () => number}}
 */
export function createResampler(fromRate, toRate, options = {}) {
  return streamResampler(fromRate, toRate, options.zeroCrossings ?? 16, true);
}
