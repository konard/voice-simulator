/** Numerical helpers for batch glottal inverse filtering (Unlicense). */
import { createFft } from './fft.js';
import { lpcAutocorrelation } from './lpc.js';

export function hann(length) {
  const result = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    result[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
  }
  return result;
}

export function block(x, centre, length) {
  const start = centre - Math.floor(length / 2);
  const result = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    result[n] = x[start + n] ?? 0;
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

export function integrate(x, leak, y = new Float64Array(x.length)) {
  let previous = 0;
  for (let n = 0; n < x.length; n++) {
    previous = x[n] + leak * previous;
    y[n] = previous;
  }
  return y;
}

export function filter(x, a, y = new Float64Array(x.length)) {
  for (let n = 0; n < x.length; n++) {
    y[n] = x[n];
    for (let k = 0; k < a.length && k < n; k++) {
      y[n] += a[k] * x[n - k - 1];
    }
  }
  return y;
}

function predictor(x, window, a, k, weighted) {
  let first = 0;
  while (first < window.length && window[first] === 0) {
    first++;
  }
  for (let n = first; n < x.length; n++) {
    weighted[n - first] = x[n] * window[n];
  }
  lpcAutocorrelation(weighted.subarray(0, x.length - first), a.length, a, k);
  if (!a.every(Number.isFinite)) {
    a.fill(0);
  }
  return a;
}

/** Alku (1992), two passes: source tilt, tract, source, tract. */
export function iaifPlan(tractOrder, glottisOrder, leak) {
  const tilt = new Float64Array(1);
  const tract = new Float64Array(tractOrder);
  const glottis = new Float64Array(glottisOrder);
  const k = new Float64Array(Math.max(1, tractOrder, glottisOrder));
  let d = new Float64Array(0);
  let g = new Float64Array(0);
  let weighted = new Float64Array(0);
  return (s, w) => {
    if (s.length > d.length) {
      const size = Math.max(s.length, d.length * 2);
      d = new Float64Array(size);
      g = new Float64Array(size);
      weighted = new Float64Array(size);
    }
    const flow = g.subarray(0, s.length);
    const derivative = d.subarray(0, s.length);
    filter(s, predictor(s, w, tilt, k, weighted), derivative);
    filter(s, predictor(derivative, w, tract, k, weighted), derivative);
    integrate(derivative, leak, flow);
    filter(s, predictor(flow, w, glottis, k, weighted), derivative);
    integrate(derivative, leak, flow);
    filter(s, predictor(flow, w, tract, k, weighted), derivative);
    integrate(derivative, leak, flow);
    return { d: derivative, g: flow };
  };
}

/** Reusable zero-padded FFT and Hann autocorrelation, for a given length. */
export function correlationPlan(length) {
  const size = 2 ** Math.ceil(Math.log2(2 * length));
  const fft = createFft(size);
  const window = hann(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  function autocorrelate(x) {
    re.fill(0);
    im.fill(0);
    re.set(x);
    fft.forward(re, im);
    for (let k = 0; k < size; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft.inverse(re, im);
  }
  autocorrelate(window);
  const wc = re.slice(0, length);
  return {
    measure(x) {
      let mean = 0;
      for (const value of x) {
        mean += value / length;
      }
      autocorrelate(x.map((v, n) => (v - mean) * window[n]));
      const result = new Float64Array(length);
      if (re[0] > 1e-30) {
        for (let lag = 0; lag < length; lag++) {
          result[lag] =
            wc[lag] > 1e-12 ? (re[lag] / re[0]) * (wc[0] / wc[lag]) : 0;
        }
      }
      return result;
    },
  };
}

/** Hann harmonic levels, exact frequencies; oscillator recurrence avoids
 * transcendental calls in the sample loop. Bins are harmonics 1..count. */
export function harmonics(x, rate, f0, count) {
  const window = hann(x.length);
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
  return (x, centre) => {
    const start = centre - Math.floor(length / 2);
    re.fill(0);
    im.fill(0);
    for (let n = 0; n < length; n++) {
      re[n] = (x[start + n] ?? 0) * window[n];
    }
    fft.forward(re, im);
    for (let k = 0; k < size; k++) {
      re[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
      im[k] = 0;
    }
    fft.inverse(re, im);
    const first = Math.ceil(0.001 * rate);
    const last = Math.min(size / 2, Math.floor(rate / minF0));
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let q = first; q <= last; q++) {
      sx += q;
      sy += re[q];
      sxx += q * q;
      sxy += q * re[q];
    }
    const count = last - first + 1;
    const slope = (count * sxy - sx * sy) / (count * sxx - sx * sx);
    const intercept = (sy - slope * sx) / count;
    let peak = Math.ceil(rate / maxF0);
    for (let q = peak + 1; q <= last; q++) {
      if (re[q] > re[peak]) {
        peak = q;
      }
    }
    return re[peak] - intercept - slope * peak;
  };
}

/** Window-corrected autocorrelation, interpolated from the two integer
 * lags neighbouring a fractional pitch period. */
export function hnr(x, centre, period, window) {
  const length = window.length;
  const start = centre - Math.floor(length / 2);
  let mean = 0;
  for (let n = 0; n < length; n++) {
    mean += (x[start + n] ?? 0) / length;
  }
  const y = new Float64Array(length);
  let r0 = 0;
  let w0 = 0;
  for (let n = 0; n < length; n++) {
    y[n] = ((x[start + n] ?? 0) - mean) * window[n];
    r0 += y[n] * y[n];
    w0 += window[n] * window[n];
  }
  const lag = Math.floor(period);
  let value = 0;
  for (let l = lag; l <= lag + 1; l++) {
    let r = 0;
    let w = 0;
    for (let n = 0; n + l < length; n++) {
      r += y[n] * y[n + l];
      w += window[n] * window[n + l];
    }
    value +=
      (r0 > 0 && w > 0 ? (r * w0) / (r0 * w) : 0) *
      (l === lag ? 1 - (period - lag) : period - lag);
  }
  value = Math.max(0.001, Math.min(0.999, value));
  return 10 * Math.log10(value / (1 - value));
}
