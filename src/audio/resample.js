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
  const result = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const center = index / ratio;
    const first = Math.max(0, Math.ceil(center - halfWidth));
    const last = Math.min(samples.length - 1, Math.floor(center + halfWidth));
    let sum = 0;
    for (let source = first; source <= last; source++) {
      const distance = center - source;
      sum +=
        samples[source] *
        cutoff *
        sinc(cutoff * distance) *
        blackman(distance / halfWidth);
    }
    result[index] = sum;
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
  const ratio = toRate / fromRate;
  const cutoff = Math.min(1, ratio) * 0.97;
  const halfWidth = zeroCrossings / cutoff;
  const table = tabulated
    ? kernelTable(fromRate, toRate, cutoff, halfWidth)
    : null;
  // Kept input: samples `base` .. `base + count - 1` of the whole stream.
  let kept = new Float64Array(64);
  let base = 0;
  let count = 0;
  // Total input so far and the index of the next output sample.
  let received = 0;
  let next = 0;

  function append(chunk) {
    if (count + chunk.length > kept.length) {
      const grown = new Float64Array(
        Math.max(kept.length * 2, count + chunk.length)
      );
      grown.set(kept.subarray(0, count));
      kept = grown;
    }
    for (let index = 0; index < chunk.length; index++) {
      kept[count + index] = chunk[index];
    }
    count += chunk.length;
    received += chunk.length;
  }

  /** Output `index` from the input up to `limit` (exclusive). */
  function output(index, limit) {
    if (table) {
      return tabulatedOutput(index, limit);
    }
    const center = index / ratio;
    const first = Math.max(0, Math.ceil(center - halfWidth));
    const last = Math.min(limit - 1, Math.floor(center + halfWidth));
    let sum = 0;
    for (let source = first; source <= last; source++) {
      const distance = center - source;
      sum +=
        kept[source - base] *
        cutoff *
        sinc(cutoff * distance) *
        blackman(distance / halfWidth);
    }
    return sum;
  }

  /** `output` with the weights of `table`. */
  function tabulatedOutput(index, limit) {
    const { phases, step, width, first, last, weights } = table;
    const position = index * step;
    const phase = position % phases;
    const whole = (position - phase) / phases;
    const start = whole + first[phase];
    const from = Math.max(0, start);
    const to = Math.min(limit - 1, whole + last[phase]);
    // Weight of input `source` is weights[row + source].
    const row = phase * width - start;
    let sum = 0;
    for (let source = from; source <= to; source++) {
      sum += kept[source - base] * weights[row + source];
    }
    return sum;
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
        result[index] = output(next + index, received);
      }
      next = end;
      trim();
      return result;
    },
    flush() {
      const length = Math.round(received * ratio);
      const result = new Float32Array(Math.max(0, length - next));
      for (let index = 0; index < result.length; index++) {
        result[index] = output(next + index, received);
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
 * joined input. It keeps about `zeroCrossings / min(1, toRate / fromRate)`
 * input samples, the half-length of the filter.
 * @param {number} fromRate
 * @param {number} toRate
 * @param {{zeroCrossings?: number}} [options]
 * @returns {{push: (chunk: ArrayLike<number>) => Float32Array, flush: () => Float32Array, held: () => number}}
 */
export function createResampler(fromRate, toRate, options = {}) {
  return streamResampler(fromRate, toRate, options.zeroCrossings ?? 16, true);
}
