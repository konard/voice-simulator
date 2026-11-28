/**
 * Front end of the Gaussian HMM recogniser: 13 log mel cepstra at 8 kHz
 * (10 ms hop, 25 ms window), utterance-normalised, plus log f0 relative
 * to the utterance median and the voicing; then a linear discriminant
 * projection of nine stacked frames. Unlicense.
 */
import { resample } from '../audio/resample.js';
import { hzToMel, melToHz } from '../metrics/spectrum.js';
import { createFft } from './fft.js';
import { analyzeFrames } from './frontend.js';
import { hmmToneFeatures } from './hmm-tone.js';
import { trackPitch } from './pitch.js';

export const HMM_RATE = 8000;
const WINDOW = 200;
const HOP = 80;
const SIZE = 256;
const FILTERS = 24;
const CEPS = 13;
const STATICS = CEPS + 2;
/** Octaves from the median beyond which a pitch is dropped. */
const PITCH_RANGE = 1;

/** Centre time (s) of feature frame t. */
export const hmmFrameTime = (t) => (t * HOP + WINDOW / 2) / HMM_RATE;

/** Time (s) of the boundary before feature frame t: halfway between centres. */
export const hmmBoundaryTime = (t) => (t * HOP + (WINDOW - HOP) / 2) / HMM_RATE;

function melBank(low, high) {
  const lo = hzToMel(low);
  const hi = hzToMel(high);
  const edges = Array.from({ length: FILTERS + 2 }, (_, i) =>
    melToHz(lo + ((hi - lo) * i) / (FILTERS + 1))
  );
  return Array.from({ length: FILTERS }, (_, m) => {
    const [a, b, c] = [edges[m], edges[m + 1], edges[m + 2]];
    const w = new Float64Array(SIZE / 2 + 1);
    for (let k = 0; k <= SIZE / 2; k++) {
      const f = (k * HMM_RATE) / SIZE;
      if (f > a && f <= b) {
        w[k] = (f - a) / (b - a);
      } else if (f > b && f < c) {
        w[k] = (c - f) / (c - b);
      }
    }
    const start = w.findIndex((value) => value > 0);
    const end = w.findLastIndex((value) => value > 0) + 1;
    return { start, weights: w.subarray(start, end) };
  });
}

let tables;
function getTables() {
  tables ??= {
    bank: melBank(100, 3500),
    fft: createFft(SIZE),
    hamming: Float64Array.from(
      { length: WINDOW },
      (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WINDOW - 1))
    ),
    dct: Array.from({ length: CEPS }, (_, n) =>
      Float64Array.from({ length: FILTERS }, (_, m) =>
        Math.cos((Math.PI * n * (m + 0.5)) / FILTERS)
      )
    ),
  };
  return tables;
}

/** Speech at the model rate. */
export function hmmAudio(samples, sampleRate) {
  return sampleRate === HMM_RATE
    ? samples
    : resample(samples, sampleRate, HMM_RATE);
}

function windowedPower(x, start, re, im, power, { hamming, fft }) {
  re.fill(0, WINDOW);
  im.fill(0);
  let prev = start > 0 ? x[start - 1] : 0;
  for (let i = 0; i < WINDOW; i++) {
    const sample = x[start + i];
    re[i] = (sample - 0.97 * prev) * hamming[i];
    prev = sample;
  }
  fft.forward(re, im);
  for (let k = 0; k < power.length; k++) {
    power[k] = re[k] * re[k] + im[k] * im[k];
  }
}

function logMel(power, bank, logs) {
  for (let m = 0; m < FILTERS; m++) {
    let energy = 0;
    const { start, weights } = bank[m];
    for (let i = 0; i < weights.length; i++) {
      energy += weights[i] * power[start + i];
    }
    logs[m] = Math.log(energy + 1e-10);
  }
}

function rawCepstra(x) {
  const tables = getTables();
  const { dct, bank } = tables;
  const count = Math.max(0, Math.floor((x.length - WINDOW) / HOP) + 1);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  const power = new Float64Array(SIZE / 2 + 1);
  const logs = new Float64Array(FILTERS);
  const raw = new Float64Array(count * STATICS);
  for (let t = 0; t < count; t++) {
    windowedPower(x, t * HOP, re, im, power, tables);
    logMel(power, bank, logs);
    const at = t * STATICS;
    for (let n = 0; n < CEPS; n++) {
      let s = 0;
      for (let m = 0; m < FILTERS; m++) {
        s += dct[n][m] * logs[m];
      }
      raw[at + n] = s;
    }
    raw[at] /= FILTERS;
  }
  return raw;
}

/**
 * c0 relative to the loudest frame, floored 60 dB down; c1.. minus their
 * mean over the frames within 30 dB of the top.
 */
function normalise(raw) {
  let top = -Infinity;
  for (let at = 0; at < raw.length; at += STATICS) {
    top = Math.max(top, raw[at]);
  }
  const mean = new Float64Array(CEPS);
  let used = 0;
  for (let at = 0; at < raw.length; at += STATICS) {
    if (raw[at] > top - 6.9) {
      used++;
      for (let n = 1; n < CEPS; n++) {
        mean[n] += raw[at + n];
      }
    }
  }
  for (let n = 1; n < CEPS; n++) {
    mean[n] /= Math.max(1, used);
  }
  for (let at = 0; at < raw.length; at += STATICS) {
    raw[at] = Math.max(raw[at] - top, -13.8);
    for (let n = 1; n < CEPS; n++) {
      raw[at + n] -= mean[n];
    }
  }
}

/**
 * A pitch more than PITCH_RANGE octaves from the median is a tracking
 * error, as on the noise of a voiceless fricative: drop it, so that it is
 * interpolated like an unvoiced frame.
 */
function dropOutliers(lf0, median) {
  for (let t = 0; t < lf0.length; t++) {
    if (Math.abs(lf0[t] - median) > PITCH_RANGE) {
      lf0[t] = NaN;
    }
  }
}

function interpolatePitch(lf0, median) {
  const count = lf0.length;
  let last = -1;
  for (let t = 0; t <= count; t++) {
    if (t < count && Number.isNaN(lf0[t])) {
      continue;
    }
    const right = t < count ? lf0[t] : null;
    const left = last >= 0 ? lf0[last] : right;
    for (let u = last + 1; u < t; u++) {
      const a = left ?? median;
      const b = right ?? a;
      lf0[u] = a + ((b - a) * (u - last)) / (t - last);
    }
    last = t;
  }
}

/**
 * Pitch statics per frame: log2 f0 minus the utterance median of the
 * voiced frames, interpolated across unvoiced frames, and the voicing.
 */
export function hmmPitchStatics(pitch, count) {
  const lf0 = new Float64Array(count).fill(NaN);
  const voicing = new Float64Array(count);
  const voiced = new Float64Array(count);
  let used = 0;
  for (let t = 0; t < count; t++) {
    const i = Math.round((hmmFrameTime(t) - pitch.startTime) / pitch.hop);
    if (i >= 0 && i < pitch.count) {
      voicing[t] = pitch.voicing[i];
      if (pitch.f0[i] > 0 && pitch.voicing[i] > 0.5) {
        const value = Math.log2(pitch.f0[i]);
        lf0[t] = value;
        voiced[used++] = value;
      }
    }
  }
  voiced.subarray(0, used).sort();
  const median = used ? voiced[used >> 1] : 0;
  dropOutliers(lf0, median);
  interpolatePitch(lf0, median);
  for (let t = 0; t < count; t++) {
    lf0[t] -= median;
  }
  return { lf0, voicing };
}

function staticFeatures(
  samples,
  pitch = trackPitch(analyzeFrames(samples, HMM_RATE, { hop: 0.01 }))
) {
  const values = rawCepstra(samples);
  normalise(values);
  const count = values.length / STATICS;
  const { lf0, voicing } = hmmPitchStatics(pitch, count);
  for (let t = 0; t < count; t++) {
    const at = t * STATICS;
    values[at + CEPS] = 4 * lf0[t];
    values[at + CEPS + 1] = voicing[t];
  }
  return { values, count, pitch, lf0, voicing };
}

/**
 * Static features of 8 kHz speech: one row of 15 values per frame, and
 * the pitch track used for them.
 */
export function hmmStatics(x, pitchAtInputRate) {
  const { values, count, pitch } = staticFeatures(x, pitchAtInputRate);
  return {
    statics: Array.from({ length: count }, (_, t) =>
      values.subarray(t * STATICS, (t + 1) * STATICS)
    ),
    pitch,
  };
}

/**
 * Project frames with the model's linear discriminant: the statics of
 * frames t-ctx..t+ctx (clamped at the ends), minus their mean, times the
 * projection rows.
 */
export function applyLda(lda, statics) {
  return projectLda(lda, statics.length, statics);
}

function projectLda(lda, frames, statics, flat) {
  const { ctx, dim, width, rows, mean, dims } = lda;
  const stat = dim / 2;
  const x = new Float64Array(width);
  const out = new Float32Array(frames * dims);
  for (let t = 0; t < frames; t++) {
    for (let j = -ctx; j <= ctx; j++) {
      const frame = Math.min(frames - 1, Math.max(0, t + j));
      const row = flat ?? statics[frame];
      const start = flat ? frame * STATICS : 0;
      const base = (j + ctx) * stat;
      for (let d = 0; d < stat; d++) {
        const k = base + d;
        x[k] = row[start + d] - mean[k];
      }
    }
    for (let r = 0; r < dims; r++) {
      let s = 0;
      const base = r * width;
      for (let d = 0; d < width; d++) {
        s += rows[base + d] * x[d];
      }
      out[t * dims + r] = s;
    }
  }
  return out;
}

/**
 * Model features of speech at any rate, the tone-stream features
 * (hmm-tone.js) and the 8 kHz pitch track.
 */
export function hmmFeatures(
  samples,
  sampleRate,
  lda,
  pitchAtInputRate,
  includeTone = true
) {
  const x = hmmAudio(samples, sampleRate);
  const { values, count, pitch, lf0, voicing } = staticFeatures(
    x,
    sampleRate === HMM_RATE ? pitchAtInputRate : undefined
  );
  return {
    feats: projectLda(lda, count, undefined, values),
    frames: count,
    pitch,
    tone: includeTone ? hmmToneFeatures(lf0, voicing) : undefined,
  };
}
