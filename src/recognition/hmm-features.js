/**
 * Front end of the Gaussian HMM recogniser: 13 log mel cepstra at 8 kHz
 * (10 ms hop, 25 ms window), utterance-normalised, plus log f0 relative
 * to the utterance median and the voicing; then a linear discriminant
 * projection of nine stacked frames. Unlicense.
 */
import { resample } from '../audio/resample.js';
import { fft, hzToMel, melToHz } from '../metrics/spectrum.js';
import { analyzeFrames } from './frontend.js';
import { hmmToneFeatures } from './hmm-tone.js';
import { trackPitch } from './pitch.js';

export const HMM_RATE = 8000;
const WINDOW = 200;
const HOP = 80;
const SIZE = 256;
const FILTERS = 24;
const CEPS = 13;
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
    return w;
  });
}

let tables;
function getTables() {
  tables ??= {
    bank: melBank(100, 3500),
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

function logMel(x, t, re, im, logs) {
  const { bank, hamming } = getTables();
  re.fill(0);
  im.fill(0);
  let prev = t * HOP > 0 ? x[t * HOP - 1] : 0;
  for (let i = 0; i < WINDOW; i++) {
    const s = x[t * HOP + i];
    re[i] = (s - 0.97 * prev) * hamming[i];
    prev = s;
  }
  fft(re, im);
  for (let m = 0; m < FILTERS; m++) {
    let e = 0;
    const w = bank[m];
    for (let k = 0; k < w.length; k++) {
      if (w[k]) {
        e += w[k] * (re[k] * re[k] + im[k] * im[k]);
      }
    }
    logs[m] = Math.log(e + 1e-10);
  }
}

function rawCepstra(x) {
  const { dct } = getTables();
  const count = Math.max(0, Math.floor((x.length - WINDOW) / HOP) + 1);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  const logs = new Float64Array(FILTERS);
  const raw = [];
  for (let t = 0; t < count; t++) {
    logMel(x, t, re, im, logs);
    const c = new Float64Array(CEPS);
    for (let n = 0; n < CEPS; n++) {
      let s = 0;
      for (let m = 0; m < FILTERS; m++) {
        s += dct[n][m] * logs[m];
      }
      c[n] = s;
    }
    c[0] /= FILTERS;
    raw.push(c);
  }
  return raw;
}

/**
 * c0 relative to the loudest frame, floored 60 dB down; c1.. minus their
 * mean over the frames within 30 dB of the top.
 */
function normalise(raw) {
  let top = -Infinity;
  for (const c of raw) {
    top = Math.max(top, c[0]);
  }
  const mean = new Float64Array(CEPS);
  let used = 0;
  for (const c of raw) {
    if (c[0] > top - 6.9) {
      used++;
      for (let n = 1; n < CEPS; n++) {
        mean[n] += c[n];
      }
    }
  }
  for (let n = 1; n < CEPS; n++) {
    mean[n] /= Math.max(1, used);
  }
  return raw.map((c) => {
    const v = new Float64Array(CEPS + 2);
    v[0] = Math.max(c[0] - top, -13.8);
    for (let n = 1; n < CEPS; n++) {
      v[n] = c[n] - mean[n];
    }
    return v;
  });
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

/**
 * Pitch statics per frame: log2 f0 minus the utterance median of the
 * voiced frames, interpolated across unvoiced frames, and the voicing.
 */
export function hmmPitchStatics(pitch, count) {
  const lf0 = new Float64Array(count).fill(NaN);
  const voicing = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const i = Math.round((hmmFrameTime(t) - pitch.startTime) / pitch.hop);
    if (i >= 0 && i < pitch.count) {
      voicing[t] = pitch.voicing[i];
      if (pitch.f0[i] > 0 && pitch.voicing[i] > 0.5) {
        lf0[t] = Math.log2(pitch.f0[i]);
      }
    }
  }
  const voiced = [...lf0].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const median = voiced.length ? voiced[voiced.length >> 1] : 0;
  dropOutliers(lf0, median);
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
  return { lf0: lf0.map((v) => v - median), voicing };
}

/**
 * Static features of 8 kHz speech: one row of 15 values per frame, and
 * the pitch track used for them.
 */
export function hmmStatics(
  x,
  pitch = trackPitch(analyzeFrames(x, HMM_RATE, { hop: 0.01 }))
) {
  const statics = normalise(rawCepstra(x));
  const { lf0, voicing } = hmmPitchStatics(pitch, statics.length);
  statics.forEach((v, t) => {
    v[CEPS] = 4 * lf0[t];
    v[CEPS + 1] = voicing[t];
  });
  return { statics, pitch };
}

/**
 * Project frames with the model's linear discriminant: the statics of
 * frames t-ctx..t+ctx (clamped at the ends), minus their mean, times the
 * projection rows.
 */
export function applyLda(lda, statics) {
  const { ctx, dim, width, rows, mean, dims } = lda;
  const stat = dim / 2;
  const frames = statics.length;
  const x = new Float64Array(width);
  const out = new Float32Array(frames * dims);
  for (let t = 0; t < frames; t++) {
    for (let j = -ctx; j <= ctx; j++) {
      const row = statics[Math.min(frames - 1, Math.max(0, t + j))];
      for (let d = 0; d < stat; d++) {
        const k = (j + ctx) * stat + d;
        x[k] = row[d] - mean[k];
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
export function hmmFeatures(samples, sampleRate, lda, inputPitch) {
  const x = hmmAudio(samples, sampleRate);
  const { statics, pitch } = hmmStatics(x, inputPitch);
  const tone = hmmToneFeatures(
    statics.map((v) => v[CEPS] / 4),
    statics.map((v) => v[CEPS + 1])
  );
  return { feats: applyLda(lda, statics), frames: statics.length, pitch, tone };
}
