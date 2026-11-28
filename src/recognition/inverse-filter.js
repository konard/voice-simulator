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
  iaifPlan,
  correlationPlan,
  harmonics,
  cppPlan,
  cepstralPeak,
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
  let best;
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
      best = model;
    }
  }
  return { rd: best?.rd, oq: best?.oq, fit };
}
function localPitch(frames, o) {
  const f0 = new Float32Array(frames.count);
  const length = Math.round(
    Math.max(frames.window, 1.5 / o.minF0) * frames.rate
  );
  const correlate = o.pitch ? null : correlationPlan(length);
  const firstLag = Math.ceil(frames.rate / o.maxF0);
  const lastLag = Math.floor(frames.rate / o.minF0);
  for (let t = 0; t < frames.count; t++) {
    if (o.pitch) {
      f0[t] = suppliedPitch(o.pitch.f0[t], frames.rate);
    } else if (frames.speech[t] && frames.periodicity[t] >= 0.5) {
      const r = correlate(
        frames.samples,
        Math.round(t * frames.hop * frames.rate)
      );
      let lag = firstLag;
      for (let k = lag + 1; k <= lastLag; k++) {
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
  return o.pitch ? f0 : smoothPitch(f0);
}

function smoothPitch(f0) {
  const sorted = new Float32Array(5);
  const median = new Float32Array(f0.length);
  for (let t = 0; t < f0.length; t++) {
    if (!f0[t]) {
      continue;
    }
    let count = 0;
    for (let n = Math.max(0, t - 2); n < Math.min(f0.length, t + 3); n++) {
      const value = f0[n];
      if (value > 0) {
        let i = count++;
        for (; i > 0 && sorted[i - 1] > value; i--) {
          sorted[i] = sorted[i - 1];
        }
        sorted[i] = value;
      }
    }
    median[t] = sorted[Math.floor(count / 2)];
  }
  return median;
}
let inverseScratch;
// Cache a working buffer up to 8 MiB, enough for 32 s of two-column
// source recovery at 16 kHz. Larger recordings use per-call storage.
const RECOVERY_CELLS = 1024 * 1024;

function takeRecoveryScratch(cells) {
  if (cells > RECOVERY_CELLS) {
    return new Float64Array(cells);
  }
  const scratch =
    inverseScratch?.length >= cells
      ? inverseScratch
      : new Float64Array(Math.min(RECOVERY_CELLS, Math.max(2048, cells * 2)));
  // A trace can call inverseFilter again while this workspace is in use.
  inverseScratch = undefined;
  return scratch;
}

function releaseRecoveryScratch(scratch) {
  if (
    scratch &&
    scratch.length <= RECOVERY_CELLS &&
    (!inverseScratch || inverseScratch.length < scratch.length)
  ) {
    inverseScratch = scratch;
  }
}

function minimumVoicedPitch(f0) {
  let lowest = Infinity;
  for (const pitch of f0) {
    if (pitch > 0 && pitch < lowest) {
      lowest = pitch;
    }
  }
  return lowest;
}

function recover(
  frames,
  f0,
  o,
  scratch,
  { stationary, lowestPitch, allocate }
) {
  const n = frames.sampleCount;
  const derivativeOnly = stationary !== undefined;
  const roundAsReady = derivativeOnly && stationary.length === 0;
  const x = highPass(frames.samples, frames.rate, scratch.subarray(0, n));
  const g = derivativeOnly ? null : scratch.subarray(2 * n, 3 * n).fill(0);
  const width = recoveryLength(lowestPitch, frames.rate);
  const weight = allocate('weight', Math.max(1, Math.min(n, width))).fill(0);
  // After the last window touching a sample, mode measurements need only its
  // rounded derivative. Keep doubles for the optional stationary blend.
  const d = roundAsReady
    ? allocate('derivativeRing', weight.length).fill(0)
    : scratch.subarray(n, 2 * n).fill(0);
  const derivative = roundAsReady
    ? new Float32Array(scratch.buffer, n * Float64Array.BYTES_PER_ELEMENT, n)
    : d;
  const normalize = normalizer(frames, f0, weight, d, g, derivative);
  const history = Math.round(0.05 * frames.rate);
  const iaif = iaifPlan(
    o.tractOrder,
    o.glottisOrder,
    o.leak,
    !derivativeOnly,
    allocate
  );
  let buffer;
  for (let time = 0; time < x.length / frames.rate; time += o.step) {
    const row = Math.min(f0.length - 1, Math.round(time / frames.hop));
    if (!(f0[row] > 0)) {
      continue;
    }
    const centre = Math.round(time * frames.rate);
    const length = recoveryLength(f0[row], frames.rate);
    const window = windowAt(length, history);
    const start = centre - Math.floor(length / 2);
    // No window at this or a subsequent centre reaches before this sample.
    normalize(Math.max(0, centre - Math.floor(width / 2)));
    buffer ??= allocate('recoveryWindow', width + history);
    const offset = start - history;
    const first = Math.max(0, -offset);
    const last = Math.min(window.length, x.length - offset);
    buffer.fill(0, 0, first);
    buffer.fill(0, last, window.length);
    for (let i = first; i < last; i++) {
      buffer[i] = x[offset + i];
    }
    const pulse = iaif(buffer, window);
    const end = Math.min(x.length, start + length);
    for (let index = Math.max(0, start); index < end; index++) {
      const i = index - start + history;
      const w = window[i];
      const slot = index % weight.length;
      d[roundAsReady ? slot : index] += w * pulse.d[i];
      if (g) {
        g[index] += w * pulse.g[i];
      }
      weight[slot] += w;
    }
  }
  normalize(n);
  return finishRecovery(frames, f0, o, stationary, { x, d, g, derivative });
}

function finishRecovery(frames, f0, o, stationary, { x, d, g, derivative }) {
  if (d !== derivative) {
    return { flowDerivative: derivative };
  }
  refineStationary(
    frames,
    o,
    x,
    d,
    g,
    stationary ?? steadySpans(frames, f0, o)
  );
  if (stationary !== undefined) {
    // x is no longer needed. Its prefix can hold the rounded derivative
    // until the caller has measured the requested spectral frames.
    const flowDerivative = new Float32Array(x.buffer, x.byteOffset, x.length);
    flowDerivative.set(d);
    return { flowDerivative };
  }
  return {
    flow: Float32Array.from(g),
    flowDerivative: Float32Array.from(d),
  };
}

function recoveryLength(pitch, rate) {
  return Math.round(Math.max(0.032, 2.5 / pitch) * rate);
}

function normalizer(frames, f0, weight, d, g, derivative) {
  const hopSamples = frames.rate * frames.hop;
  const ring = d !== derivative;
  let n = 0;
  return (end) => {
    for (; n < end; n++) {
      const slot = n % weight.length;
      const scale = weight[slot];
      const row = Math.min(f0.length - 1, Math.round(n / hopSamples));
      const voiced = scale > 0.01 && f0[row] > 0;
      const index = ring ? slot : n;
      derivative[n] = voiced ? d[index] / scale : 0;
      if (ring) {
        d[index] = 0;
      }
      if (g) {
        g[n] = voiced ? g[n] / scale : 0;
      }
      weight[slot] = 0;
    }
  };
}

const windows = new Map();
const WINDOW_LIMIT = 1024 * 1024;
let windowBytes = 0;

function windowAt(length, prefix = 0) {
  // At the supported rates and pitches both lengths fit in 13 bits.
  const key = prefix * 8192 + length;
  const cached = windows.get(key);
  if (cached) {
    return cached;
  }
  const window = new Float64Array(length + prefix);
  hann(length, prefix ? window.subarray(prefix) : window);
  while (windowBytes + window.byteLength > WINDOW_LIMIT) {
    const oldest = windows.keys().next().value;
    windowBytes -= windows.get(oldest).byteLength;
    windows.delete(oldest);
  }
  windows.set(key, window);
  windowBytes += window.byteLength;
  return window;
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
/** Candidates for a single tract model require steady pitch and harmonics. */
function* steadySpans(frames, f0, o) {
  if (o.tractOrder > 32) {
    return;
  }
  const { hop } = frames;
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
    const pitch = f0[Math.floor((first + t - 1) / 2)];
    if (!f0.subarray(first, t).every((v) => Math.abs(v / pitch - 1) <= 0.01)) {
      continue;
    }
    if (steadySpectrum(frames, first, t, pitch)) {
      yield { first, end: t, pitch };
    }
  }
}

function refineStationary(frames, o, x, d, g, spans) {
  const { rate, hop } = frames;
  const length = Math.round(0.064 * rate);
  for (const { first, end, pitch } of spans) {
    const centre = Math.round(((first + end - 1) * hop * rate) / 2);
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
    const right = Math.min(x.length, Math.round((end - 0.5) * hop * rate));
    const history = Math.round(0.05 * rate);
    const start = Math.max(0, left - history);
    const residual = filter(x.subarray(start, right), fit.a);
    const fade = Math.round(0.032 * rate);
    mixRecovery(d, residual, left, right, start, fade);
    if (g) {
      mixRecovery(g, integrate(residual, o.leak), left, right, start, fade);
    }
  }
}

function mixRecovery(output, residual, left, right, start, fade) {
  for (let n = left; n < right; n++) {
    const mix = Math.min(1, (n - left) / fade, (right - 1 - n) / fade);
    output[n] = output[n] * (1 - mix) + residual[n - start] * mix;
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
    const row = t * bands;
    let lowSum = 0;
    for (let i = 0; i < low.length; i++) {
      lowSum += frames.mel[row + low[i]];
    }
    let midSum = 0;
    for (let i = 0; i < mid.length; i++) {
      midSum += frames.mel[row + mid[i]];
    }
    sum += lowSum / low.length - midSum / mid.length;
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

/** The three source columns used by voice-mode classification at vowel rows. */
export function inverseModeMeasures(frames, options, rows) {
  const o = settings(frames, options);
  if (options.kernels?.module) {
    return inverseFilterRust(
      options.kernels.module,
      frames,
      o,
      MEASURES,
      MODE_MEASURES,
      rows
    );
  }
  return inverseFilterJs(
    { ...frames, samples: frames.samples.subarray(0, frames.sampleCount) },
    o,
    true,
    rows
  );
}

function inverseFilterJs(frames, o, modesOnly = false, rows) {
  const f0 = localPitch(frames, o);
  const hasLowBand = lowBand(frames, f0);
  const recoverSource =
    !modesOnly ||
    (hasLowBand && (rows ? rows.some((t) => f0[t]) : f0.some(Boolean)));
  const stationary =
    recoverSource && modesOnly ? [...steadySpans(frames, f0, o)] : undefined;
  const columns = modesOnly ? (stationary?.length ? 2 : 1.5) : 3;
  const scratch = recoverSource
    ? takeRecoveryScratch(Math.ceil(frames.sampleCount * columns))
    : null;
  const work = spareWindows ?? new Map();
  spareWindows = undefined;
  try {
    return inverseMeasures(frames, o, {
      f0,
      hasLowBand,
      modesOnly,
      rows,
      scratch,
      stationary,
      allocate: (name, length) => inverseColumn(work, name, length),
    });
  } finally {
    spareWindows = work;
    releaseRecoveryScratch(scratch);
  }
}

let spareWindows;
const MAX_WINDOW_CELLS = 16384;

// One set of short analysis windows can be shared by sequential recordings.
// A call from a trace receives its own storage while the outer set is in use.
function inverseColumn(work, name, length) {
  if (length > MAX_WINDOW_CELLS) {
    return new Float64Array(length);
  }
  let column = work.get(name);
  if (!column || column.length < length) {
    column = new Float64Array(2 ** Math.ceil(Math.log2(Math.max(1, length))));
    work.set(name, column);
  }
  return column.length === length ? column : column.subarray(0, length);
}

function inverseMeasures(
  frames,
  o,
  { f0, hasLowBand, modesOnly, rows, scratch, stationary, allocate }
) {
  const { rate, hop, count, startTime } = frames;
  const lowestPitch = minimumVoicedPitch(f0);
  const result = {
    hop,
    startTime,
    count,
    rate,
    ...(scratch &&
      recover(frames, f0, o, scratch, { stationary, lowestPitch, allocate })),
    f0,
    reliable: new Uint8Array(count),
    lowBand: hasLowBand,
    summary: {},
  };
  const names = modesOnly ? MODE_MEASURES : MEASURES.slice(1);
  for (const name of names) {
    result[name] = new Float32Array(count).fill(NaN);
  }
  const { flowDerivative: d } = result;
  if (!modesOnly) {
    result.gci = closures(frames, f0, d);
  }
  const cpp = cppPlan(rate, o.minF0, o.maxF0, allocate);
  const longestPeriod = rate / lowestPitch;
  const signal = allocate('signal', Math.round(6 * longestPeriod));
  const sources = modesOnly
    ? signal
    : allocate('sources', Math.round(2 * longestPeriod));
  const spectralPlan = {
    scratch: signal,
    sources,
    frames,
    modesOnly,
    maxF0: o.maxF0,
  };
  const rowsCount = rows?.length ?? count;
  for (let i = 0; i < rowsCount; i++) {
    const t = rows ? rows[i] : i;
    if (!f0[t]) {
      continue;
    }
    const centre = Math.round(t * hop * rate);
    const period = rate / f0[t];
    if (d) {
      measureSourceFrame(result, t, centre, period, spectralPlan);
    }
    result.hnr[t] = hnr(frames.samples, centre, period, signal);
    result.cpp[t] = cepstralPeak(cpp, frames.samples, centre);
  }
  if (modesOnly) {
    const { h1h2Source, hnr, cpp } = result;
    return { h1h2Source, hnr, cpp };
  }
  completeInverseFilter(result, o.trace);
  return result;
}

function completeInverseFilter(result, trace) {
  if (!result.lowBand) {
    for (const name of SOURCE_MEASURES) {
      result[name].fill(NaN);
    }
  }
  for (const name of MEASURES) {
    result.summary[name] = summarize(result[name], result.reliable);
  }
  trace?.({
    stage: 'complete',
    voiced: result.f0.filter((v) => v > 0).length,
    closures: result.gci.length,
    lowBand: result.lowBand,
    summary: result.summary,
  });
}

function measureSourceFrame(
  result,
  t,
  centre,
  period,
  { scratch, sources, frames, modesOnly, maxF0 }
) {
  const { flow, flowDerivative, f0 } = result;
  const { rate, samples } = frames;
  const length = Math.round(2 * period);
  const source = block(
    flowDerivative,
    centre,
    length,
    sources.subarray(0, length)
  );
  const window = windowAt(length);
  const h = harmonics(
    source,
    rate,
    f0[t],
    Math.min(modesOnly ? 2 : 10, Math.floor((0.45 * rate) / f0[t])),
    window
  );
  result.h1h2Source[t] = h[0] - h[1];
  if (!modesOnly) {
    const buffer = scratch.subarray(0, length);
    const speech = harmonics(
      block(samples, centre, length, buffer),
      rate,
      f0[t],
      2,
      window
    );
    const g = block(flow, centre, length, buffer);
    addPulseFit(result, t, maxF0, h);
    result.h1h2[t] = speech[0] - speech[1];
    result.naq[t] = normalizedAmplitude(g, source, period);
  }
}

function addPulseFit(result, t, maxF0, h) {
  const fit = fitPulse(h);
  result.rd[t] = fit.rd;
  result.oq[t] = fit.oq;
  result.fit[t] = fit.fit;
  result.reliable[t] = result.f0[t] <= maxF0 && fit.fit <= 6 ? 1 : 0;
}

function normalizedAmplitude(flow, source, period) {
  let lo = Infinity;
  let hi = -Infinity;
  let peak = 0;
  for (let n = 0; n < flow.length; n++) {
    lo = Math.min(lo, flow[n]);
    hi = Math.max(hi, flow[n]);
    peak = Math.max(peak, -source[n]);
  }
  return peak > 0 ? (hi - lo) / (peak * period) : NaN;
}
