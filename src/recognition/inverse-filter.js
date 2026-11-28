/** Batch IAIF and LF source measures of finished speech (issue 61).
 * Unlicense. References and numerical definitions: docs/INVERSE-FILTER.md. */
import { lfParameters, lfWaveform } from '../acoustics/glottis.js';
import { createFft } from './fft.js';
import { inverseFilterRust } from './inverse-rust.js';
import { refine } from './inverse-refinement.js';
import {
  block,
  hann,
  highPass,
  createIaif,
  correlationPlan,
  harmonics,
  cppPlan,
  hnr,
  filter,
  integrate,
} from './inverse-dsp.js';

export { INVERSE_FILTER_DEFAULTS } from './inverse-options.js';
import { settings, suppliedPitch } from './inverse-options.js';
const MEASURES = [
  'f0',
  'rd',
  'fit',
  'oq',
  'naq',
  'h1h2',
  'h1h2Source',
  'hnr',
  'cpp',
];
const SOURCE_MEASURES = ['rd', 'oq', 'naq', 'h1h2', 'h1h2Source'];
const MODE_MEASURES = ['h1h2Source', 'hnr', 'cpp'];

export function rdToTenseness(rd) {
  return 1 - rd / 3;
}

/** Ten dB levels of a 256-point, unwindowed LF period. A fresh copy. */
export function lfHarmonics(tenseness) {
  if (!Number.isFinite(tenseness) || tenseness < 0 || tenseness > 1) {
    throw new RangeError('tenseness must be finite and from 0 to 1');
  }
  const p = lfParameters(tenseness);
  const re = Float64Array.from({ length: 256 }, (_, n) =>
    lfWaveform(p, n / 256)
  );
  const im = new Float64Array(256);
  createFft(256).forward(re, im);
  return Float64Array.from(
    { length: 10 },
    (_, k) => 10 * Math.log10(re[k + 1] ** 2 + im[k + 1] ** 2 + 1e-24)
  );
}
let models;
function lfModels() {
  models ??= Array.from({ length: 38 }, (_, i) => {
    const tenseness = 0.1 + i * 0.02;
    const pulse = lfParameters(tenseness);
    const levels = lfHarmonics(tenseness);
    const means = levels.map((_, index) => {
      const count = index + 1;
      let mean = 0;
      for (let k = 0; k < count; k++) {
        mean += levels[k] / count;
      }
      return mean;
    });
    return {
      rd: 3 * (1 - tenseness),
      oq: Math.min(1, pulse.te + pulse.ta),
      levels,
      means,
    };
  });
  return models;
}
function fitPulse(h) {
  const mean = h.reduce((a, b) => a + b, 0) / h.length;
  let fitted;
  let fit = Infinity;
  for (const model of lfModels()) {
    const m = model.means[h.length - 1];
    let error = 0;
    for (let k = 0; k < h.length; k++) {
      error += (h[k] - mean - (model.levels[k] - m)) ** 2;
    }
    error = Math.sqrt(error / h.length);
    if (error < fit) {
      fit = error;
      fitted = model;
    }
  }
  return { rd: fitted?.rd, oq: fitted?.oq, fit };
}
function localPitch(frames, o) {
  const f0 = new Float32Array(frames.count);
  const length = Math.round(
    Math.max(frames.window, 1.5 / o.minF0) * frames.rate
  );
  const plan = o.pitch ? null : correlationPlan(length);
  for (let t = 0; t < frames.count; t++) {
    if (o.pitch) {
      f0[t] = suppliedPitch(o.pitch.f0[t], frames.rate);
    } else if (frames.speech[t] && frames.periodicity[t] >= 0.5) {
      const r = plan.measure(
        block(frames.samples, Math.round(t * frames.hop * frames.rate), length)
      );
      let lag = Math.ceil(frames.rate / o.maxF0);
      for (let k = lag + 1; k <= Math.floor(frames.rate / o.minF0); k++) {
        if (r[k] > r[lag]) {
          lag = k;
        }
      }
      const curvature = r[lag - 1] - 2 * r[lag] + r[lag + 1];
      const offset =
        curvature < 0
          ? Math.max(
              -0.5,
              Math.min(0.5, (0.5 * (r[lag - 1] - r[lag + 1])) / curvature)
            )
          : 0;
      f0[t] = frames.rate / (lag + offset);
    }
  }
  if (o.pitch) {
    return f0;
  }
  return f0.map((value, t) => {
    if (!value) {
      return 0;
    }
    const values = Array.from(f0.subarray(Math.max(0, t - 2), t + 3))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
}
function recoveryPlan(length, history, o) {
  const window = hann(length);
  const extended = new Float64Array(history + length);
  const extendedWindow = new Float64Array(extended.length);
  extendedWindow.set(window, history);
  const extract = createIaif(
    extendedWindow,
    o.tractOrder,
    o.glottisOrder,
    o.leak
  );
  return { window, extended, extract };
}

function recover(frames, f0, o) {
  const x = highPass(
    frames.samples.subarray(0, frames.sampleCount),
    frames.rate
  );
  const d = new Float64Array(x.length);
  const g = new Float64Array(x.length);
  const weight = new Float64Array(x.length);
  const history = Math.round(0.05 * frames.rate);
  let plan;
  for (let time = 0; time < x.length / frames.rate; time += o.step) {
    const row = Math.min(f0.length - 1, Math.round(time / frames.hop));
    if (!(f0[row] > 0)) {
      continue;
    }
    const centre = Math.round(time * frames.rate);
    const length = Math.round(Math.max(0.032, 2.5 / f0[row]) * frames.rate);
    if (plan?.window.length !== length) {
      plan = recoveryPlan(length, history, o);
    }
    const start = centre - Math.floor(length / 2);
    const { window, extended, extract } = plan;
    for (let n = 0; n < extended.length; n++) {
      extended[n] = x[start - history + n] ?? 0;
    }
    const pulse = extract(extended);
    for (let n = 0; n < length; n++) {
      const index = start + n;
      if (index >= 0 && index < x.length) {
        d[index] += window[n] * pulse.d[n + history];
        g[index] += window[n] * pulse.g[n + history];
        weight[index] += window[n];
      }
    }
  }
  for (let n = 0; n < x.length; n++) {
    const row = Math.min(
      f0.length - 1,
      Math.round(n / (frames.rate * frames.hop))
    );
    if (weight[n] > 0.01 && f0[row] > 0) {
      d[n] /= weight[n];
      g[n] /= weight[n];
    } else {
      d[n] = 0;
      g[n] = 0;
    }
  }
  refineStationary(frames, f0, o, x, d, g);
  return { flow: Float32Array.from(g), flowDerivative: Float32Array.from(d) };
}
function steadySpectrum(frames, first, last, pitch) {
  const { rate, hop } = frames;
  let reference;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const position = Math.round(
      (first + fraction * (last - first - 1)) * hop * rate
    );
    const h = harmonics(
      block(frames.samples, position, Math.round((4 * rate) / pitch)),
      rate,
      pitch,
      10
    );
    const mean = h.reduce((a, b) => a + b, 0) / h.length;
    for (let k = 0; k < h.length; k++) {
      h[k] -= mean;
    }
    if (reference && h.some((v, k) => Math.abs(v - reference[k]) > 1)) {
      return false;
    }
    reference = h;
  }
  return true;
}
/** A single tract can be identified over a steady voiced stretch. Moving
 * speech keeps the four-stage IAIF result. The stationarity gate compares
 * pitch and centred speech harmonic levels at three separated positions. */
function refineStationary(frames, f0, o, x, d, g) {
  if (o.tractOrder > 32) {
    return;
  }
  const { rate, hop } = frames;
  for (let t = 0; t < f0.length; ) {
    if (!f0[t]) {
      t++;
      continue;
    }
    const first = t;
    while (t < f0.length && f0[t] > 0) {
      t++;
    }
    if ((t - first) * hop < 0.2) {
      continue;
    }
    const centre = Math.round(((first + t - 1) * hop * rate) / 2);
    const pitch = f0[Math.floor((first + t - 1) / 2)];
    if (!f0.subarray(first, t).every((v) => Math.abs(v / pitch - 1) <= 0.01)) {
      continue;
    }
    const length = Math.round(0.064 * rate);
    if (!steadySpectrum(frames, first, t, pitch)) {
      continue;
    }
    const seed = minimum(
      d,
      centre - (0.5 * rate) / pitch,
      centre + (0.5 * rate) / pitch
    );
    const fit = refine(
      block(frames.samples, centre, length),
      o.tractOrder,
      pitch,
      rate,
      seed - centre + Math.floor(length / 2)
    );
    o.trace?.({
      stage: 'stationary-refinement',
      time: centre / rate + frames.startTime,
      error: fit?.error ?? null,
    });
    if (!fit) {
      continue;
    }
    const left = Math.max(0, Math.round((first - 0.5) * hop * rate));
    const right = Math.min(x.length, Math.round((t - 0.5) * hop * rate));
    const history = Math.round(0.05 * rate);
    const start = Math.max(0, left - history);
    const residual = filter(x.subarray(start, right), fit.a);
    const flow = integrate(residual, o.leak);
    const fade = Math.round(0.032 * rate);
    for (let n = left; n < right; n++) {
      const mix = Math.min(1, (n - left) / fade, (right - 1 - n) / fade);
      d[n] = d[n] * (1 - mix) + residual[n - start] * mix;
      g[n] = g[n] * (1 - mix) + flow[n - start] * mix;
    }
  }
}
function minimum(x, first, last) {
  let best = Math.max(0, Math.ceil(first));
  for (let n = best + 1; n <= Math.min(x.length - 1, Math.floor(last)); n++) {
    if (x[n] < x[best]) {
      best = n;
    }
  }
  return best;
}
function closures(frames, f0, d) {
  const marks = [];
  const { rate, hop, startTime } = frames;
  for (let t = 0; t < f0.length; ) {
    if (!f0[t]) {
      t++;
      continue;
    }
    const first = t;
    while (t < f0.length && f0[t] > 0) {
      t++;
    }
    const left = Math.max(0, Math.round((first - 0.5) * hop * rate));
    const right = Math.min(d.length - 1, Math.round((t - 0.5) * hop * rate));
    const middle = (left + right) / 2;
    const seed = minimum(
      d,
      Math.max(left, middle - 0.015 * rate),
      Math.min(right, middle + 0.015 * rate)
    );
    marks.push(seed);
    for (const direction of [-1, 1]) {
      let n = seed;
      while (true) {
        const row = Math.min(
          f0.length - 1,
          Math.max(first, Math.round(n / (hop * rate)))
        );
        const period = rate / f0[row];
        const expected = n + direction * period;
        if (expected < left || expected > right) {
          break;
        }
        const next = minimum(
          d,
          Math.max(left, expected - 0.3 * period),
          Math.min(right, expected + 0.3 * period)
        );
        if (direction * (next - n) < 0.5 * period) {
          break;
        }
        marks.push(next);
        n = next;
      }
    }
  }
  return Float64Array.from(
    marks.sort((a, b) => a - b),
    (n) => startTime + n / rate
  );
}
function lowBand(frames, f0) {
  const bands = frames.melBands;
  const mel = (f) => 2595 * Math.log10(1 + f / 700);
  const bottom = mel(60);
  const top = mel(Math.min(frames.rate / 2, 7600));
  const low = [];
  const mid = [];
  for (let m = 0; m < bands; m++) {
    const hz =
      700 *
      (10 ** ((bottom + ((top - bottom) * (m + 1)) / (bands + 1)) / 2595) - 1);
    if (hz < 250) {
      low.push(m);
    }
    if (hz >= 300 && hz <= 1000) {
      mid.push(m);
    }
  }
  if (!low.length || !mid.length) {
    return true;
  }
  let sum = 0;
  let count = 0;
  for (let t = 0; t < f0.length; t++) {
    if (!f0[t]) {
      continue;
    }
    const average = (indices) =>
      indices.reduce((v, m) => v + frames.mel[t * bands + m], 0) /
      indices.length;
    sum += average(low) - average(mid);
    count++;
  }
  return !count || sum / count >= -4.6;
}
function summarize(values, reliable) {
  const x = Array.from(values)
    .filter((v, t) => reliable[t] && Number.isFinite(v))
    .sort((a, b) => a - b);
  const percentile = (p) => {
    if (!x.length) {
      return null;
    }
    const index = p * (x.length - 1);
    const i = Math.floor(index);
    return x[i] + (x[Math.min(i + 1, x.length - 1)] - x[i]) * (index - i);
  };
  return {
    median: percentile(0.5),
    low: percentile(0.25),
    high: percentile(0.75),
    frames: x.length,
  };
}

/** No stream state: call on a completed FrameSet or a finished stretch. */
export function inverseFilter(frames, options = {}) {
  const o = settings(frames, options);
  if (options.kernels?.module && !o.trace) {
    return inverseFilterRust(options.kernels.module, frames, o, MEASURES);
  }
  return inverseFilterJs(
    { ...frames, samples: frames.samples.subarray(0, frames.sampleCount) },
    o
  );
}

/** The mode classifier reads only these measurements at vowel nuclei. */
export function measureModeSource(frames, pitch, rows, kernels, step) {
  const options = {
    pitch,
    minF0: 35,
    maxF0: 800,
    kernels,
    ...(step !== undefined && { step }),
  };
  if (kernels?.module) {
    return inverseFilter(frames, options);
  }
  return inverseFilterJs(
    { ...frames, samples: frames.samples.subarray(0, frames.sampleCount) },
    settings(frames, options),
    rows
  );
}

function measurePulse(result, t, frame, f0, source, harmonicsAtF0) {
  const { samples, flow, rate, centre, length, period, maxF0, window } = frame;
  const fit = fitPulse(harmonicsAtF0);
  result.rd[t] = fit.rd;
  result.oq[t] = fit.oq;
  result.fit[t] = fit.fit;
  const speech = harmonics(block(samples, centre, length), rate, f0, 2, window);
  result.h1h2[t] = speech[0] - speech[1];
  const g = block(flow, centre, length);
  let lo = Infinity;
  let hi = -Infinity;
  let peak = 0;
  for (let n = 0; n < length; n++) {
    lo = Math.min(lo, g[n]);
    hi = Math.max(hi, g[n]);
    peak = Math.max(peak, -source[n]);
  }
  result.naq[t] = peak > 0 ? (hi - lo) / (peak * period) : NaN;
  result.reliable[t] = f0 <= maxF0 && fit.fit <= 6 ? 1 : 0;
}

function measureSourceRows(frames, o, result, modeRows) {
  const { rate, hop, count, samples } = frames;
  const { flow, flowDerivative: derivative, f0 } = result;
  const cpp = cppPlan(rate, o.minF0, o.maxF0);
  const windows = new Map();
  const windowOf = (length) => {
    if (!windows.has(length)) {
      windows.set(length, hann(length));
    }
    return windows.get(length);
  };
  for (let t = 0; t < count; t++) {
    if (!f0[t] || (modeRows && !modeRows[t])) {
      continue;
    }
    const centre = Math.round(t * hop * rate);
    const period = rate / f0[t];
    const length = Math.round(2 * period);
    if (derivative) {
      const window = windowOf(length);
      const source = block(derivative, centre, length);
      const harmonicsAtF0 = harmonics(
        source,
        rate,
        f0[t],
        Math.min(modeRows ? 2 : 10, Math.floor((0.45 * rate) / f0[t])),
        window
      );
      result.h1h2Source[t] = harmonicsAtF0[0] - harmonicsAtF0[1];
      if (!modeRows) {
        measurePulse(
          result,
          t,
          {
            samples,
            flow,
            rate,
            centre,
            length,
            period,
            maxF0: o.maxF0,
            window,
          },
          f0[t],
          source,
          harmonicsAtF0
        );
      }
    }
    result.hnr[t] = hnr(
      samples,
      centre,
      period,
      windowOf(Math.round(6 * period))
    );
    result.cpp[t] = cpp(samples, centre);
  }
}

function inverseFilterJs(frames, o, modeRows) {
  const { rate, hop, count, startTime } = frames;
  const f0 = localPitch(frames, o);
  const validLowBand = lowBand(frames, f0);
  const result = {
    hop,
    startTime,
    count,
    rate,
    ...(!modeRows || validLowBand ? recover(frames, f0, o) : {}),
    f0,
    reliable: new Uint8Array(count),
    lowBand: validLowBand,
    summary: {},
  };
  for (const name of modeRows ? MODE_MEASURES : MEASURES.slice(1)) {
    result[name] = new Float32Array(count).fill(NaN);
  }
  if (!modeRows) {
    result.gci = closures(frames, f0, result.flowDerivative);
  }
  measureSourceRows(frames, o, result, modeRows);
  if (modeRows) {
    return result;
  }
  if (!result.lowBand) {
    for (const name of SOURCE_MEASURES) {
      result[name].fill(NaN);
    }
  }
  for (const name of MEASURES) {
    result.summary[name] = summarize(result[name], result.reliable);
  }
  o.trace?.({
    stage: 'complete',
    voiced: f0.filter((v) => v > 0).length,
    closures: result.gci.length,
    lowBand: result.lowBand,
    summary: result.summary,
  });
  return result;
}
