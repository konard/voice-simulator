/** Types of ./lpc.js (re-exported by src/index.d.ts). */

/** Output arrays of the LPC functions: `order` values or more. */
export type LpcArray = Float64Array | Float32Array | number[];
/**
 * Linear prediction of one frame `x` (issue 58). `a` receives a_1 .. a_p of
 * A(z) = 1 + sum_i a_i z^-i (a_i in a[i - 1]), `k` the reflection
 * coefficients; the result is the residual power E (mean squared error).
 */
export type LpcMethod = (
  x: ArrayLike<number>,
  order: number,
  a: LpcArray,
  k: LpcArray
) => number;
/** Burg's method (the default of the front end). */
export declare const lpcBurg: LpcMethod;
/** Autocorrelation method (Levinson-Durbin). */
export declare const lpcAutocorrelation: LpcMethod;
/** Covariance method (Cholesky); falls back to Burg when unstable. */
export declare const lpcCovariance: LpcMethod;
/** Step-up recursion: the predictor `a` from the reflection coefficients. */
export declare function predictorFromReflection<T extends LpcArray>(
  k: ArrayLike<number>,
  order: number,
  a: T
): T;
/** 10 log10(E / |A(e^{j 2 pi frequency / rate})|^2) in dB. */
export declare function lpcLevel(
  a: ArrayLike<number>,
  order: number,
  power: number,
  frequency: number,
  rate: number
): number;
