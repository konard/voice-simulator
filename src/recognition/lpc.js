/**
 * Linear prediction of one analysis frame: Burg's method, the
 * autocorrelation method (Levinson-Durbin) and the covariance method
 * (Cholesky), after Makhoul (1975) and Markel and Gray (1976).
 *
 * Every function takes the frame `x`, the order `p` and two output arrays of
 * length `p`: `a` receives the predictor coefficients a_1 .. a_p of
 * A(z) = 1 + sum_i a_i z^-i (a_i in `a[i - 1]`) and `k` the reflection
 * coefficients k_1 .. k_p (k_m in `k[m - 1]`). They return the residual
 * power E, the mean squared prediction error. Scratch memory is kept between
 * calls: a frame loop allocates only for a frame longer than all before it.
 */

let scratchA = new Float64Array(64);
let scratchB = new Float64Array(64);
let scratchC = new Float64Array(64);

/** Scratch arrays of at least `length` values. */
function scratch(length) {
  if (scratchA.length < length) {
    const size = 2 ** Math.ceil(Math.log2(length));
    scratchA = new Float64Array(size);
    scratchB = new Float64Array(size);
    scratchC = new Float64Array(size);
  }
}

function checkOrder(x, order, a, k) {
  if (!Number.isInteger(order) || order < 1) {
    throw new RangeError(`LPC order must be a positive integer, got ${order}`);
  }
  if (a.length < order || k.length < order) {
    throw new RangeError(`LPC output arrays need ${order} values`);
  }
  return x.length;
}

function clear(a, k, order) {
  for (let i = 0; i < order; i++) {
    a[i] = 0;
    k[i] = 0;
  }
}

/**
 * Step-up recursion: the predictor of order `order` from its reflection
 * coefficients. For m = 1 .. order: a_i <- a_i + k_m a_{m-i} (i < m) and
 * a_m = k_m.
 * @param {ArrayLike<number>} k k_1 .. k_order in k[0 .. order - 1].
 * @param {number} order
 * @param {Float64Array|Float32Array|number[]} a Receives a_1 .. a_order.
 * @returns {Float64Array|Float32Array|number[]} `a`.
 */
export function predictorFromReflection(k, order, a) {
  for (let m = 1; m <= order; m++) {
    stepUp(a, m, k[m - 1]);
  }
  return a;
}

/** One step of the step-up recursion, in place on a_1 .. a_{m-1}. */
function stepUp(a, m, reflection) {
  let i = 1;
  let j = m - 1;
  for (; i < j; i++, j--) {
    const ai = a[i - 1];
    const aj = a[j - 1];
    a[i - 1] = ai + reflection * aj;
    a[j - 1] = aj + reflection * ai;
  }
  if (i === j) {
    a[i - 1] += reflection * a[i - 1];
  }
  a[m - 1] = reflection;
}

/**
 * Burg's method. With f[n] = b[n] = x[n] and E = mean(x^2), for
 * m = 1 .. p: k_m = -2 S1 / S2 with S1 = sum_{n=m}^{N-1} f[n] b[n-1] and
 * S2 = sum_{n=m}^{N-1} (f[n]^2 + b[n-1]^2); then f[n] <- f[n] + k_m b[n-1]
 * and b[n] <- b[n-1] + k_m f[n] (old values on the right), the step-up of
 * `a` and E <- E (1 - k_m^2). Every |k_m| is at most 1, so the synthesis
 * filter 1 / A(z) is stable.
 * @param {ArrayLike<number>} x
 * @param {number} order
 * @param {Float64Array|Float32Array|number[]} a
 * @param {Float64Array|Float32Array|number[]} k
 * @returns {number} Residual power E.
 */
export function lpcBurg(x, order, a, k) {
  const length = checkOrder(x, order, a, k);
  clear(a, k, order);
  if (length === 0) {
    return 0;
  }
  scratch(length);
  const f = scratchA;
  const b = scratchB;
  let power = 0;
  for (let n = 0; n < length; n++) {
    f[n] = x[n];
    b[n] = x[n];
    power += x[n] * x[n];
  }
  let error = power / length;
  let s1 = 0;
  let s2 = 0;
  for (let n = 1; n < length; n++) {
    const fn = f[n];
    const bn = b[n - 1];
    s1 += fn * bn;
    s2 += fn * fn + bn * bn;
  }
  const last = Math.min(order, length - 1);
  for (let m = 1; m <= last; m++) {
    const reflection = s2 > 0 ? (-2 * s1) / s2 : 0;
    k[m - 1] = reflection;
    stepUp(a, m, reflection);
    error *= 1 - reflection * reflection;
    if (m === last) {
      break;
    }
    // Carry the old backward value forward while accumulating the next
    // order from the updated errors in ascending sample order.
    let previous = b[m];
    let backward = b[m - 1] + reflection * f[m];
    f[m] += reflection * b[m - 1];
    s1 = 0;
    s2 = 0;
    for (let n = m + 1; n < length; n++) {
      const fn = f[n];
      const forward = fn + reflection * previous;
      f[n] = forward;
      s1 += forward * backward;
      s2 += forward * forward + backward * backward;
      b[n - 1] = backward;
      backward = previous + reflection * fn;
      previous = b[n];
    }
    b[length - 1] = backward;
  }
  return error;
}

/**
 * Autocorrelation method: Levinson-Durbin on r[i] = sum_n x[n] x[n + i].
 * @param {ArrayLike<number>} x
 * @param {number} order
 * @param {Float64Array|Float32Array|number[]} a
 * @param {Float64Array|Float32Array|number[]} k
 * @returns {number} Residual power E (the final Levinson error over N).
 */
export function lpcAutocorrelation(x, order, a, k) {
  const length = checkOrder(x, order, a, k);
  if (length === 0) {
    clear(a, k, order);
    return 0;
  }
  scratch(order + 1);
  const r = scratchA;
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let n = 0; n + lag < length; n++) {
      sum += x[n] * x[n + lag];
    }
    r[lag] = sum;
  }
  return lpcFromAutocorrelation(r, order, a, k) / length;
}

/** Solve the prediction coefficients from an autocorrelation sequence. */
export function lpcFromAutocorrelation(r, order, a, k) {
  clear(a, k, order);
  let error = r[0];
  if (!(error > 0)) {
    return 0;
  }
  for (let m = 1; m <= order; m++) {
    let acc = r[m];
    for (let j = 1; j < m; j++) {
      acc += a[j - 1] * r[m - j];
    }
    const reflection = -acc / error;
    k[m - 1] = reflection;
    stepUp(a, m, reflection);
    error *= 1 - reflection * reflection;
  }
  return error;
}

/**
 * phi(i, j) = sum_{n=p}^{N-1} x[n-i] x[n-j] for i, j = 0 .. p into `phi`
 * (row-major, width p + 1): phi(0, j) directly, then phi(i, j) =
 * phi(i-1, j-1) + x[p-i] x[p-j] - x[N-i] x[N-j] (Markel and Gray 1976,
 * eq. 3.43).
 */
function covarianceMatrix(x, p, length, phi) {
  const width = p + 1;
  for (let j = 0; j <= p; j++) {
    let sum = 0;
    for (let n = p; n < length; n++) {
      sum += x[n] * x[n - j];
    }
    phi[j] = sum;
    phi[j * width] = sum;
  }
  for (let i = 1; i <= p; i++) {
    for (let j = i; j <= p; j++) {
      const value =
        phi[(i - 1) * width + j - 1] +
        x[p - i] * x[p - j] -
        x[length - i] * x[length - j];
      phi[i * width + j] = value;
      phi[j * width + i] = value;
    }
  }
}

/**
 * Cholesky L L^T of phi(1..p, 1..p) + diagonal I into `lower` (p by p,
 * row-major). Returns false when the matrix is not positive definite.
 */
function cholesky(phi, p, diagonal, lower) {
  const width = p + 1;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = phi[(i + 1) * width + j + 1] + (i === j ? diagonal : 0);
      for (let m = 0; m < j; m++) {
        sum -= lower[i * p + m] * lower[j * p + m];
      }
      if (i === j && !(sum > 0)) {
        return false;
      }
      lower[i * p + j] = i === j ? Math.sqrt(sum) : sum / lower[j * p + j];
    }
  }
  return true;
}

/** Solve L L^T a = -phi(1..p, 0) into `solution`. */
function choleskySolve(phi, p, lower, solution) {
  const width = p + 1;
  for (let i = 0; i < p; i++) {
    let sum = -phi[(i + 1) * width];
    for (let m = 0; m < i; m++) {
      sum -= lower[i * p + m] * solution[m];
    }
    solution[i] = sum / lower[i * p + i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let sum = solution[i];
    for (let m = i + 1; m < p; m++) {
      sum -= lower[m * p + i] * solution[m];
    }
    solution[i] = sum / lower[i * p + i];
  }
}

/**
 * Step-down recursion of a_1 .. a_p in `work` (overwritten):
 * k_m = a_m^(m), a_i^(m-1) = (a_i - k_m a_{m-i}) / (1 - k_m^2). Returns
 * false when some |k_m| >= 1.
 */
function stepDown(work, p, k) {
  for (let m = p; m >= 1; m--) {
    const reflection = work[m - 1];
    if (!(Math.abs(reflection) < 1)) {
      return false;
    }
    k[m - 1] = reflection;
    const scale = 1 / (1 - reflection * reflection);
    for (let i = 1, j = m - 1; i <= j; i++, j--) {
      const ai = work[i - 1];
      const aj = work[j - 1];
      work[i - 1] = (ai - reflection * aj) * scale;
      if (i !== j) {
        work[j - 1] = (aj - reflection * ai) * scale;
      }
    }
  }
  return true;
}

/**
 * Covariance method: solve sum_j a_j phi(i, j) = -phi(i, 0), i = 1 .. p,
 * with phi(i, j) = sum_{n=p}^{N-1} x[n-i] x[n-j], by Cholesky after adding
 * 1e-9 phi(0, 0) to the diagonal; the reflection coefficients come from the
 * step-down recursion. When Cholesky fails or some |k_m| >= 1 (an unstable
 * predictor), the result of `lpcBurg` is returned.
 * @param {ArrayLike<number>} x
 * @param {number} order
 * @param {Float64Array|Float32Array|number[]} a
 * @param {Float64Array|Float32Array|number[]} k
 * @returns {number} Residual power E (mean over the N - p predicted samples).
 */
export function lpcCovariance(x, order, a, k) {
  const length = checkOrder(x, order, a, k);
  const p = order;
  if (length <= p) {
    return lpcBurg(x, order, a, k);
  }
  scratch((p + 1) * (p + 1) + p + 1);
  const phi = scratchA;
  covarianceMatrix(x, p, length, phi);
  const total = phi[0];
  const lower = scratchB;
  const solution = scratchC;
  if (!(total > 0) || !cholesky(phi, p, 1e-9 * total, lower)) {
    return lpcBurg(x, order, a, k);
  }
  choleskySolve(phi, p, lower, solution);
  let error = total;
  for (let j = 0; j < p; j++) {
    error += solution[j] * phi[j + 1];
  }
  // The step-down works on a copy in scratchB (L is no longer needed).
  const work = scratchB;
  work.set(solution.subarray(0, p));
  if (!stepDown(work, p, k)) {
    return lpcBurg(x, order, a, k);
  }
  for (let i = 0; i < p; i++) {
    a[i] = solution[i];
  }
  return Math.max(0, error) / (length - p);
}

/**
 * Level (dB) of the all-pole model at one frequency:
 * 10 log10(E / |A(e^{j 2 pi frequency / rate})|^2).
 * @param {ArrayLike<number>} a a_1 .. a_order.
 * @param {number} order
 * @param {number} power Residual power E.
 * @param {number} frequency Hz.
 * @param {number} rate Sample rate (Hz).
 * @returns {number}
 */
export function lpcLevel(a, order, power, frequency, rate) {
  const omega = (2 * Math.PI * frequency) / rate;
  let re = 1;
  let im = 0;
  for (let i = 1; i <= order; i++) {
    re += a[i - 1] * Math.cos(omega * i);
    im -= a[i - 1] * Math.sin(omega * i);
  }
  return 10 * Math.log10(power / (re * re + im * im));
}
