/** Types of ./fft.js (re-exported by src/index.d.ts). */

/** A planned radix-2 transform of `size` points (issue 58). */
export interface Fft {
  readonly size: number;
  /** In place: X[k] = sum_n x[n] e^{-2 pi i k n / size}. */
  forward(re: Float64Array, im: Float64Array): void;
  /** In place: x[n] = (1 / size) sum_k X[k] e^{2 pi i k n / size}. */
  inverse(re: Float64Array, im: Float64Array): void;
}
/**
 * The one fast Fourier transform of the library; `size` is a power of two
 * from 2 to 65536, otherwise a RangeError is thrown.
 */
export declare function createFft(size: number): Fft;
