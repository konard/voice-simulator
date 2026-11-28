/** Numerical helpers for batch glottal inverse filtering (Unlicense). */
import { createFft } from './fft.js';
import { lpcAutocorrelation } from './lpc.js';

export function hann(length, result = new Float64Array(length)) {
  for (let n = 0; n < length; n++) {
    result[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
  }
  return result;
}

export function block(x, centre, length, result = new Float64Array(length)) {
  const start = centre - Math.floor(length / 2);
  const first = Math.max(0, -start);
  const end = Math.max(first, Math.min(length, x.length - start));
  result.fill(0, 0, first);
  result.fill(0, end);
  for (let n = first; n < end; n++) {
    result[n] = x[start + n];
  }
  return result;
}

/** Zero-phase first-order 50 Hz high-pass, with zero boundary states. */
export function highPass(x, rate, y = new Float64Array(x.length)) {
  y.set(x);
  const r = 1 - (2 * Math.PI * 50) / rate;
  for (const direction of [1, -1]) {
    let previous = 0;
    let output = 0;
    for (let i = 0; i < y.length; i++) {
      const n = direction === 1 ? i : y.length - 1 - i;
      const input = y[n];
      output = input - previous + r * output;
      previous = input;
      y[n] = output;
    }
  }
  return y;
}

export function integrate(
  x,
  leak,
  y = new Float64Array(x.length),
  length = x.length
) {
  let previous = 0;
  for (let n = 0; n < length; n++) {
    previous = x[n] + leak * previous;
    y[n] = previous;
  }
  return y;
}

export function filter(
  x,
  a,
  y = new Float64Array(x.length),
  length = x.length
) {
  for (let n = 0; n < length; n++) {
    let value = x[n];
    const count = Math.min(a.length, n);
    for (let k = 0; k < count; k++) {
      value += a[k] * x[n - k - 1];
    }
    y[n] = value;
  }
  return y;
}

function predictor(x, window, first, a, k, weighted) {
  const length = window.length;
  for (let n = first; n < length; n++) {
    weighted[n - first] = x[n] * window[n];
  }
  lpcAutocorrelation(weighted, a.length, a, k, length - first);
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) {
      a.fill(0);
      break;
    }
  }
  return a;
}

/** Alku (1992), two passes: source tilt, tract, source, tract. */
export function iaifPlan(tractOrder, glottisOrder, leak, flowOutput = true) {
  const tilt = new Float64Array(1);
  const tract = new Float64Array(tractOrder);
  const glottis = new Float64Array(glottisOrder);
  const k = new Float64Array(Math.max(1, tractOrder, glottisOrder));
  const pulse = { d: new Float64Array(0), g: new Float64Array(0) };
  let weighted = new Float64Array(0);
  return (s, w) => {
    const length = w.length;
    if (length > pulse.d.length) {
      const size = Math.max(length, pulse.d.length * 2);
      pulse.d = new Float64Array(size);
      pulse.g = new Float64Array(size);
      weighted = new Float64Array(size);
    }
    const { d, g } = pulse;
    let first = 0;
    while (first < length && w[first] === 0) {
      first++;
    }
    filter(s, predictor(s, w, first, tilt, k, weighted), d, length);
    filter(s, predictor(d, w, first, tract, k, weighted), d, length);
    integrate(d, leak, g, length);
    filter(s, predictor(g, w, first, glottis, k, weighted), d, length);
    integrate(d, leak, g, length);
    filter(s, predictor(g, w, first, tract, k, weighted), d, length);
    if (flowOutput) {
      integrate(d, leak, g, length);
    }
    // The first `length` samples belong to this call and are borrowed until
    // the next window.
    return pulse;
  };
}

/** Reusable zero-padded FFT and Hann autocorrelation, for a given length. */
export function correlationPlan(length) {
  const size = 2 ** Math.ceil(Math.log2(2 * length));
  const fft = createFft(size);
  const window = hann(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  function autocorrelate() {
    im.fill(0);
    fft.forward(re, im);
    for (let k = 0; k < size; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft.inverse(re, im);
  }
  re.set(window);
  autocorrelate();
  const wc = re.slice(0, length);
  const result = new Float64Array(length);
  return (samples, centre) => {
    block(samples, centre, length, re);
    let mean = 0;
    for (let n = 0; n < length; n++) {
      mean += re[n] / length;
    }
    for (let n = 0; n < length; n++) {
      re[n] = (re[n] - mean) * window[n];
    }
    autocorrelate();
    if (re[0] > 1e-30) {
      for (let lag = 0; lag < length; lag++) {
        result[lag] =
          wc[lag] > 1e-12 ? (re[lag] / re[0]) * (wc[0] / wc[lag]) : 0;
      }
    } else {
      result.fill(0);
    }
    return result;
  };
}

/** Hann harmonic levels, exact frequencies; oscillator recurrence avoids
 * transcendental calls in the sample loop. Bins are harmonics 1..count. */
export function harmonics(x, rate, f0, count, window = hann(x.length)) {
  const levels = new Float64Array(count);
  for (let k = 1; k <= count; k++) {
    const angle = (2 * Math.PI * f0 * k) / rate;
    const cr = Math.cos(angle);
    const ci = Math.sin(angle);
    let wr = 1;
    let wi = 0;
    let re = 0;
    let im = 0;
    for (let n = 0; n < x.length; n++) {
      re += x[n] * window[n] * wr;
      im -= x[n] * window[n] * wi;
      const next = wr * cr - wi * ci;
      wi = wi * cr + wr * ci;
      wr = next;
    }
    levels[k - 1] = 10 * Math.log10(re * re + im * im + 1e-24);
  }
  return levels;
}

/** Hillenbrand et al. (1994), with the scale defined in issue 61. */
export function cppPlan(rate, minF0, maxF0) {
  const length = Math.round(0.04 * rate);
  const size = 2 ** Math.ceil(Math.log2(length));
  const fft = createFft(size);
  const window = hann(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const first = Math.ceil(0.001 * rate);
  const last = Math.min(size / 2, Math.floor(rate / minF0));
  const firstPeak = Math.ceil(rate / maxF0);
  const count = last - first + 1;
  let sx = 0;
  let sxx = 0;
  for (let q = first; q <= last; q++) {
    sx += q;
    sxx += q * q;
  }
  return {
    fft,
    window,
    re,
    im,
    first,
    last,
    firstPeak,
    count,
    sx,
    denominator: count * sxx - sx * sx,
  };
}

export function cepstralPeak(plan, x, centre) {
  const {
    fft,
    window,
    re,
    im,
    first,
    last,
    firstPeak,
    count,
    sx,
    denominator,
  } = plan;
  const start = centre - Math.floor(window.length / 2);
  re.fill(0);
  im.fill(0);
  const firstSample = Math.max(0, -start);
  const endSample = Math.min(window.length, x.length - start);
  for (let n = firstSample; n < endSample; n++) {
    re[n] = x[start + n] * window[n];
  }
  fft.forward(re, im);
  for (let k = 0; k < re.length; k++) {
    re[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
    im[k] = 0;
  }
  fft.inverse(re, im);
  let sy = 0;
  let sxy = 0;
  for (let q = first; q <= last; q++) {
    sy += re[q];
    sxy += q * re[q];
  }
  const slope = (count * sxy - sx * sy) / denominator;
  const intercept = (sy - slope * sx) / count;
  let peak = firstPeak;
  for (let q = peak + 1; q <= last; q++) {
    if (re[q] > re[peak]) {
      peak = q;
    }
  }
  return re[peak] - intercept - slope * peak;
}

const HNR_PERIODS = 6;
const hnrWindows = new Map();

function windowProduct(window, lag) {
  let sum = 0;
  for (let n = 0; n + lag < window.length; n++) {
    sum += window[n] * window[n + lag];
  }
  return sum;
}

function hnrWindow(length) {
  if (!hnrWindows.has(length)) {
    if (hnrWindows.size === 64) {
      hnrWindows.delete(hnrWindows.keys().next().value);
    }
    const window = hann(length);
    // Periods that round to this window length span at most two integer
    // lags. Include the upper neighbour for interpolation.
    const first = Math.max(0, Math.floor((length - 0.5) / HNR_PERIODS));
    const products = [
      windowProduct(window, first),
      windowProduct(window, first + 1),
      windowProduct(window, first + 2),
    ];
    hnrWindows.set(length, {
      window,
      first,
      products,
      zero: windowProduct(window, 0),
    });
  }
  return hnrWindows.get(length);
}

/** Window-corrected autocorrelation, interpolated from the two integer
 * lags neighbouring a fractional pitch period. */
export function hnr(x, centre, period, y) {
  const { window, first, products, zero } = hnrWindow(
    Math.round(HNR_PERIODS * period)
  );
  const length = window.length;
  const start = centre - Math.floor(length / 2);
  const firstSample = Math.max(0, Math.min(length, -start));
  const endSample = Math.max(firstSample, Math.min(length, x.length - start));
  let mean = 0;
  for (let n = firstSample; n < endSample; n++) {
    mean += x[start + n] / length;
  }
  y.fill(-mean, 0, firstSample);
  for (let n = firstSample; n < endSample; n++) {
    y[n] = x[start + n] - mean;
  }
  y.fill(-mean, endSample, length);
  let r0 = 0;
  for (let n = 0; n < length; n++) {
    y[n] *= window[n];
    r0 += y[n] * y[n];
  }
  const lag = Math.floor(period);
  let value = 0;
  for (let l = lag; l <= lag + 1; l++) {
    let r = 0;
    for (let n = 0; n + l < length; n++) {
      r += y[n] * y[n + l];
    }
    const w = products[l - first];
    value +=
      (r0 > 0 && w > 0 ? (r * zero) / (r0 * w) : 0) *
      (l === lag ? 1 - (period - lag) : period - lag);
  }
  value = Math.max(0.001, Math.min(0.999, value));
  return 10 * Math.log10(value / (1 - value));
}
