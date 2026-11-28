/**
 * Frequency-dependent losses of the vocal tract walls (issue 36).
 *
 * Two mechanisms set the formant bandwidths of a closed-glottis vowel
 * besides radiation:
 *
 * - Viscous and thermal boundary layers attenuate a plane wave by
 *   alpha = sqrt(pi f) (sqrt(nu) + (gamma - 1) sqrt(kappa)) / (r c) per cm,
 *   which grows with sqrt(f) and with the perimeter / area of the tube
 *   (Flanagan 1972, eq. 3.33). Real tracts are not round and their walls
 *   are not smooth, so `shape` (LOSS_SHAPE) scales the round-tube value.
 * - Yielding walls: the soft tissue is a mass m, a resistance b and a
 *   stiffness k per cm² of wall (Ishizaka, French & Flanagan 1975). They
 *   add a shunt admittance S / (b + j (w m - k / w)) per section of wall
 *   area S, which widens and raises F1 of close vowels and makes a closed
 *   tract resonate near 190 Hz.
 *
 * The 1D waveguide applies the boundary-layer loss of each group of
 * sections with one first-order filter per travelling wave
 * (designLossFilter), and the walls as a mass-spring branch at the end of
 * each group. The tube transfer function (transfer.js) uses both exactly.
 */

import { SPEED_OF_SOUND } from './constants.js';

/** Kinematic viscosity (cm²/s), thermal diffusivity (cm²/s), cp / cv. */
const VISCOSITY = 0.15;
const DIFFUSIVITY = 0.21;
const GAMMA = 1.4;

/**
 * Boundary-layer loss of the tract relative to a smooth round tube of the
 * same area (1-3): calibrated against Hawks & Miller (1995) with
 * experiments/issue-11-bandwidths.mjs.
 */
export const LOSS_SHAPE = 1.3;

/**
 * Groups of oral tract sections that share one loss filter and wall
 * (calibrated with LOSS_SHAPE).
 */
export const LOSS_STAGES = 5;
/** Groups of nose sections. */
export const NOSE_LOSS_STAGES = 2;

/** Wall mass (g/cm²), resistance (g/(cm² s)) and stiffness (g/(cm² s²)). */
export const WALL_MASS = 2.1;
export const WALL_RESISTANCE = 800;
export const WALL_STIFFNESS = 84500;

/** Hawks & Miller (1995) polynomial coefficients below and above 500 Hz. */
const BANDWIDTH_LOW = [
  165.327516, -6.73636734e-1, 1.80874446e-3, -4.52201682e-6, 7.49514e-9,
  -4.70219241e-12,
];
const BANDWIDTH_HIGH = [
  15.8146139, 8.10159009e-2, -9.79728215e-5, 5.28725064e-8, -1.07099364e-11,
  7.91528509e-16,
];

/**
 * Formant bandwidth (Hz) of natural speech at a formant frequency (Hz),
 * for a voice with fundamental `f0` (Hawks & Miller 1995, eq. 2-3).
 * @param {number} frequency
 * @param {number} [f0]
 */
export function publishedBandwidth(frequency, f0 = 132) {
  const coefficients = frequency < 500 ? BANDWIDTH_LOW : BANDWIDTH_HIGH;
  let sum = 0;
  for (let power = coefficients.length - 1; power >= 0; power--) {
    sum = sum * frequency + coefficients[power];
  }
  return (1 + (0.25 * (f0 - 132)) / 88) * sum;
}

/**
 * Viscous and thermal attenuation (nepers per cm) of a plane wave at
 * `frequency` (Hz) in a tube of `area` (cm²), `shape` times a smooth round
 * tube: about 5.1e-5 shape sqrt(f / area).
 * @param {number} frequency
 * @param {number} area
 * @param {number} [shape]
 */
export function viscothermalLoss(frequency, area, shape = 1) {
  const radius = Math.sqrt(Math.max(area, 1e-4) / Math.PI);
  return (
    (shape *
      Math.sqrt(Math.PI * frequency) *
      (Math.sqrt(VISCOSITY) + (GAMMA - 1) * Math.sqrt(DIFFUSIVITY))) /
    (radius * SPEED_OF_SOUND)
  );
}

/**
 * Sections of a tract whose length is the reference length of
 * constrictionLoss.
 */
export const LOSS_REFERENCE_SECTIONS = 44;

/**
 * Loss (nepers) of a section of `area` (cm²) and of 1 / 44 of the tract
 * length to the flow resistance of narrow constrictions (Bernoulli/kinetic
 * losses), which dominates below a few tenths of a cm². It matches the
 * resistance rho U / A² of a steady flow U of about 150 cm³/s: a 1.5 cm
 * long 0.15 cm² constriction (/u/) loses U / (2 A c), about 1.5 % of the
 * wave amplitude, so the low formants of rounded and close vowels stay
 * sharp. It does not depend on frequency; the waveguide and the tube
 * transfer function share it.
 * @param {number} area
 */
export function constrictionLoss(area) {
  return -Math.log1p(-Math.min(0.3, 0.0001 / Math.max(area, 1e-3) ** 2));
}

/** Wall area (cm²) of a section of `area` (cm²) and `length` (cm). */
export function wallSurface(area, length) {
  return 2 * Math.sqrt(Math.PI * Math.max(area, 0)) * length;
}

/**
 * Shunt admittance S / (b + j (w m - k / w)) of `surface` cm² of yielding
 * wall at `frequency` (Hz), in cm³ / (s dyn / cm²).
 * @param {number} frequency
 * @param {number} surface
 * @param {{mass?: number, resistance?: number, stiffness?: number}} [wall]
 * @returns {{re: number, im: number}}
 */
export function wallAdmittance(frequency, surface, wall = {}) {
  const {
    mass = WALL_MASS,
    resistance = WALL_RESISTANCE,
    stiffness = WALL_STIFFNESS,
  } = wall;
  const omega = 2 * Math.PI * frequency;
  const reactance = omega * mass - stiffness / omega;
  const scale = surface / (resistance * resistance + reactance * reactance);
  return { re: resistance * scale, im: -reactance * scale };
}

/**
 * Frequencies (Hz) the loss filter is fitted on: 250 Hz to 8 kHz (below
 * 0.45 of the sampling rate), evenly spaced on a log scale.
 */
function designGrid(rate) {
  const top = Math.min(8000, 0.45 * rate);
  const points = 41;
  return Array.from(
    { length: points },
    (_, index) => 250 * (top / 250) ** (index / (points - 1))
  );
}

/**
 * For a pole at -a, the C, D that minimise the largest relative error of
 * C + D h(f) against sqrt(f), where h(f) = (a + cos w) / (1 + a² + 2 a cos w)
 * is how the loss of a first-order shelf with that pole changes with its
 * zero (Lawson's iteratively reweighted least squares).
 */
function fitShelf(a, { cosine, roots, x, y, weights }) {
  const length = x.length;
  weights.fill(1 / length);
  for (let index = 0; index < length; index++) {
    const c = cosine[index];
    y[index] = (a + c) / (1 + a * a + 2 * a * c) / roots[index];
  }
  let bestError = Infinity;
  let bestC;
  let bestD;
  for (let iteration = 0; iteration < 40; iteration++) {
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let t1 = 0;
    let t2 = 0;
    for (let index = 0; index < length; index++) {
      const w = weights[index];
      const gx = x[index];
      const gy = y[index];
      s11 += w * gx * gx;
      s12 += w * gx * gy;
      s22 += w * gy * gy;
      t1 += w * gx;
      t2 += w * gy;
    }
    const det = s11 * s22 - s12 * s12;
    const C = (t1 * s22 - t2 * s12) / det;
    const D = (s11 * t2 - s12 * t1) / det;
    let error = 0;
    let total = 0;
    for (let index = 0; index < length; index++) {
      const residual = Math.abs(C * x[index] + D * y[index] - 1);
      error = Math.max(error, residual);
      weights[index] *= residual;
      total += weights[index];
    }
    if (error < bestError) {
      bestError = error;
      bestC = C;
      bestD = D;
    }
    if (!(total > 0)) {
      break;
    }
    for (let index = 0; index < length; index++) {
      weights[index] /= total;
    }
  }
  return bestError < Infinity
    ? { a, C: bestC, D: bestD, error: bestError }
    : { error: Infinity };
}

const shelves = new Map();
/**
 * Pole and loss slopes of the best first-order shelf at a sampling rate,
 * cached per 500 Hz of rate (the waveguide rate follows the tract length).
 */
export function lossShelf(sampleRate) {
  const rate = Math.max(500, Math.round(sampleRate / 500) * 500);
  let shape = shelves.get(rate);
  if (!shape) {
    const grid = designGrid(rate);
    const cosine = Float64Array.from(grid, (frequency) =>
      Math.cos((2 * Math.PI * frequency) / rate)
    );
    const roots = Float64Array.from(grid, Math.sqrt);
    const fit = {
      cosine,
      roots,
      x: roots.map((root) => 1 / root),
      y: new Float64Array(grid.length),
      weights: new Float64Array(grid.length),
    };
    // Golden-section search for the pole.
    const ratio = (Math.sqrt(5) - 1) / 2;
    let low = -0.98;
    let high = 0.5;
    let x1 = high - ratio * (high - low);
    let x2 = low + ratio * (high - low);
    let f1 = fitShelf(x1, fit);
    let f2 = fitShelf(x2, fit);
    for (let iteration = 0; iteration < 30; iteration++) {
      if (f1.error < f2.error) {
        high = x2;
        x2 = x1;
        f2 = f1;
        x1 = high - ratio * (high - low);
        f1 = fitShelf(x1, fit);
      } else {
        low = x1;
        x1 = x2;
        f1 = f2;
        x2 = low + ratio * (high - low);
        f2 = fitShelf(x2, fit);
      }
    }
    shape = f1.error < f2.error ? f1 : f2;
    // The loss of the shelf is only linear in K for small K: its zero is
    // solved exactly at the two ends of the grid (designLossFilter).
    shape.low = cosine[0];
    shape.high = cosine.at(-1);
    // Loss per unit K at both ends, and the loss of the pole there.
    const h = (c) => (shape.a + c) / (1 + shape.a ** 2 + 2 * shape.a * c);
    shape.slopeLow = shape.C + shape.D * h(shape.low);
    shape.slopeHigh = shape.C + shape.D * h(shape.high);
    shape.poleLow = zeroLoss(shape.a, shape.low);
    shape.poleHigh = zeroLoss(shape.a, shape.high);
    shelves.set(rate, shape);
  }
  return shape;
}

/** Loss (nepers) of a zero at -b at a frequency with cos w = c. */
function zeroLoss(b, c) {
  return -0.5 * Math.log(1 + b * b + 2 * b * c);
}

/**
 * Largest |zero| of a loss filter: a zero at -1 would remove the Nyquist
 * frequency, beyond which no first-order shelf adds high-frequency loss.
 */
const ZERO_LIMIT = 0.999;

/**
 * First-order filter y = b0 x + b1 x[n-1] - a1 y[n-1] whose gain follows
 * exp(-K sqrt(f)) from 250 Hz to 8 kHz.
 *
 * The issue proposed a one-pole filter matched at 500 and 4000 Hz, but a
 * one-pole gain cannot follow sqrt(f): it misses the loss by 38 % at
 * 250 Hz and 95 % at 8 kHz (experiments/issue-36-loss-filter.mjs). A
 * one-pole one-zero shelf can: its pole and slopes are fitted once per
 * rate for the smallest largest relative error of the loss (below 12 %,
 * experiments/issue-36-loss-check.mjs), and K only moves its zero and
 * gain, solved so that the loss is exact at both ends of the band.
 *
 * With r = exp(-2 (wanted loss difference of the two ends)), a zero at -b
 * meets both ends when 1 + b² + 2 b c_low = r (1 + b² + 2 b c_high), a
 * quadratic whose roots multiply to 1: its root inside the unit circle is
 * the zero. A duct so narrow that no zero up to ZERO_LIMIT gives enough
 * high-frequency loss (K above about 0.02 at 45 kHz, met only in a closed
 * nose of a lossy head) keeps the exact low-end loss and a passive,
 * finite filter with its zero at ZERO_LIMIT.
 * @param {number} K Loss in nepers at 1 Hz (it grows with sqrt(f)).
 * @param {number} sampleRate
 * @returns {{b0: number, b1: number, a1: number}}
 */
export function designLossFilter(K, sampleRate) {
  return setLossFilter(K, lossShelf(sampleRate), { b0: 0, b1: 0, a1: 0 });
}

/** Write coefficients into a filter using the shelf already selected. */
export function setLossFilter(K, shelf, targetFilter) {
  const { a, low, high, slopeLow, slopeHigh, poleLow, poleHigh } = shelf;
  // Loss the fitted model wants at both ends, less that of the pole.
  const wantLow = K * slopeLow + poleLow;
  const wantHigh = K * slopeHigh + poleHigh;
  const target = wantLow - wantHigh;
  // (1 - r) b² + 2 q b + (1 - r) = 0, solved without cancellation (q = 0
  // only when r = 1 and the two ends are the same frequency).
  const gap = -Math.expm1(-2 * target);
  const q = low - (1 - gap) * high;
  const root = Math.sqrt(q * q - gap * gap);
  let zero = q * q > gap * gap ? -gap / (q + Math.sign(q) * root) : NaN;
  if (!(Math.abs(zero) <= ZERO_LIMIT)) {
    // The loss difference falls as the zero moves from -1 to 1: take the
    // end of the bracket the wanted difference lies beyond.
    const error = zeroLoss(ZERO_LIMIT, low) - zeroLoss(ZERO_LIMIT, high);
    zero = error > target ? ZERO_LIMIT : -ZERO_LIMIT;
  }
  const b0 = Math.exp(zeroLoss(zero, low) - wantLow);
  targetFilter.b0 = b0;
  targetFilter.b1 = b0 * zero;
  targetFilter.a1 = a;
  return targetFilter;
}

/**
 * Gain of a loss filter at `frequency` (Hz).
 * @param {{b0: number, b1: number, a1: number}} filter
 * @param {number} frequency
 * @param {number} sampleRate
 */
export function lossFilterGain({ b0, b1, a1 }, frequency, sampleRate) {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const c = Math.cos(w);
  const numerator = b0 * b0 + b1 * b1 + 2 * b0 * b1 * c;
  const denominator = 1 + a1 * a1 + 2 * a1 * c;
  return Math.sqrt(numerator / denominator);
}
