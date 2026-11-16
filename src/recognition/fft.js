/**
 * The one fast Fourier transform of the library (issue 58): an iterative
 * radix-2 Cooley-Tukey transform whose tables of cosines, sines and
 * bit-reversed indexes are made once per plan. The metrics of issue 18
 * (`fft` in src/metrics/spectrum.js) and the recognition front end
 * (src/recognition/frontend.js) both run on it.
 */

/** Smallest and largest transform sizes. */
const MIN_SIZE = 2;
const MAX_SIZE = 65536;

/**
 * Plan a transform of `size` points.
 *
 * `forward(re, im)` replaces the two arrays, in place, by
 * X[k] = sum_n x[n] e^{-2 pi i k n / size}; `inverse(re, im)` by
 * x[n] = (1 / size) sum_k X[k] e^{2 pi i k n / size}. Both take two
 * `Float64Array`s (any indexable arrays of numbers work) of length `size`
 * and allocate nothing.
 * @param {number} size A power of two from 2 to 65536.
 * @returns {{size: number, forward: (re: Float64Array, im: Float64Array) => void, inverse: (re: Float64Array, im: Float64Array) => void}}
 */
export function createFft(size) {
  if (
    !Number.isInteger(size) ||
    size < MIN_SIZE ||
    size > MAX_SIZE ||
    (size & (size - 1)) !== 0
  ) {
    throw new RangeError(
      `createFft: size ${size} is not a power of two from ${MIN_SIZE} to ${MAX_SIZE}`
    );
  }
  const half = size / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / size);
    sin[k] = Math.sin((2 * Math.PI * k) / size);
  }
  const bits = Math.log2(size);
  const reversed = new Uint32Array(size);
  for (let index = 0; index < size; index++) {
    let value = 0;
    for (let bit = 0; bit < bits; bit++) {
      value |= ((index >> bit) & 1) << (bits - 1 - bit);
    }
    reversed[index] = value;
  }

  function check(re, im) {
    if (re.length !== size || im.length !== size) {
      throw new RangeError(
        `fft: expected two arrays of ${size} values, got ${re.length} and ${im.length}`
      );
    }
  }

  /** Butterflies with the twiddle factors e^{sign 2 pi i k / size}. */
  function transform(re, im, sign) {
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
    for (let width = 1; width < size; width *= 2) {
      const step = size / (2 * width);
      for (let start = 0; start < size; start += 2 * width) {
        for (let k = 0; k < width; k++) {
          const wr = cos[k * step];
          const wi = sign * sin[k * step];
          const a = start + k;
          const b = a + width;
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

  return Object.freeze({
    size,
    forward(re, im) {
      check(re, im);
      transform(re, im, -1);
    },
    inverse(re, im) {
      check(re, im);
      transform(re, im, 1);
      const scale = 1 / size;
      for (let index = 0; index < size; index++) {
        re[index] *= scale;
        im[index] *= scale;
      }
    },
  });
}
