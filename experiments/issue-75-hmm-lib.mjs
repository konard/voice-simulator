/* eslint-disable complexity */
/**
 * Feasibility probe: Gaussian state models estimated from the
 * simulator's own renders (random voices, sentences sampled from the
 * recognition word counts, never the round-trip corpus) and Viterbi
 * decoding. Unlicense.
 */
import { resample } from '../src/audio/resample.js';
import { fft, hzToMel, melToHz } from '../src/metrics/spectrum.js';
import { getCounts } from '../src/recognition/data/index.js';
import { createRandom } from '../src/random.js';

export const RATE = 8000;
const WINDOW = 200;
const HOP = 80;
const SIZE = 256;
const FILTERS = 24;
const CEPS = 13;

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
      const f = (k * RATE) / SIZE;
      if (f > a && f <= b) {
        w[k] = (f - a) / (b - a);
      } else if (f > b && f < c) {
        w[k] = (c - f) / (c - b);
      }
    }
    return w;
  });
}
const BANK = melBank(100, 3500);
const HAMMING = Float64Array.from(
  { length: WINDOW },
  (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WINDOW - 1))
);
const DCT = Array.from({ length: CEPS }, (_, n) =>
  Float64Array.from({ length: FILTERS }, (_, m) =>
    Math.cos((Math.PI * n * (m + 0.5)) / FILTERS)
  )
);

/** Log mel cepstra c0..c12 with CMN of c1.., c0 relative to the max, plus deltas. */
export function features(samples, sampleRate) {
  const x = sampleRate === RATE ? samples : resample(samples, sampleRate, RATE);
  const count = Math.max(0, Math.floor((x.length - WINDOW) / HOP) + 1);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  const raw = [];
  for (let t = 0; t < count; t++) {
    re.fill(0);
    im.fill(0);
    let prev = t * HOP > 0 ? x[t * HOP - 1] : 0;
    for (let i = 0; i < WINDOW; i++) {
      const s = x[t * HOP + i];
      re[i] = (s - 0.97 * prev) * HAMMING[i];
      prev = s;
    }
    fft(re, im);
    const logs = new Float64Array(FILTERS);
    for (let m = 0; m < FILTERS; m++) {
      let e = 0;
      const w = BANK[m];
      for (let k = 0; k < w.length; k++) {
        if (w[k]) {
          e += w[k] * (re[k] * re[k] + im[k] * im[k]);
        }
      }
      logs[m] = Math.log(e + 1e-10);
    }
    const c = new Float64Array(CEPS);
    for (let n = 0; n < CEPS; n++) {
      let s = 0;
      for (let m = 0; m < FILTERS; m++) {
        s += DCT[n][m] * logs[m];
      }
      c[n] = s;
    }
    raw.push(c);
  }
  // c0 as mean log filter energy relative to the loudest frame, floored
  // 60 dB down; c1.. minus their mean over frames within 30 dB of the top.
  for (const c of raw) {
    c[0] /= FILTERS;
  }
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
  const base = raw.map((c) => {
    const v = new Float64Array(CEPS);
    v[0] = Math.max(c[0] - top, -13.8);
    for (let n = 1; n < CEPS; n++) {
      v[n] = c[n] - mean[n];
    }
    return v;
  });
  const D = CEPS * 2;
  return base.map((c, t) => {
    const v = new Float32Array(D);
    v.set(c);
    const a = base[Math.max(0, t - 2)];
    const b = base[Math.max(0, t - 1)];
    const d = base[Math.min(base.length - 1, t + 1)];
    const e = base[Math.min(base.length - 1, t + 2)];
    for (let n = 0; n < CEPS; n++) {
      v[CEPS + n] = (2 * (e[n] - a[n]) + (d[n] - b[n])) / 10;
    }
    return v;
  });
}

/** Frame labels from the plan segments: phone symbol and third of segment. */
export function frameLabels(plan, frames) {
  const labels = new Array(frames).fill('sil');
  const states = new Int8Array(frames);
  // Word-boundary pauses shorter than 30 ms carry no silence: the
  // previous segment keeps those frames.
  const segments = [];
  for (const seg of plan.segments) {
    if (seg.kind === 'pause' && seg.duration < 0.03 && segments.length) {
      segments[segments.length - 1] = { ...segments.at(-1), end: seg.end };
    } else {
      segments.push(seg);
    }
  }
  for (const seg of segments) {
    let label;
    if (seg.kind === 'pause') {
      label = 'sil';
    } else if (seg.kind === 'release') {
      label = `${seg.token.symbol}_r`;
    } else {
      label = seg.token.symbol;
    }
    const from = Math.round((seg.start * RATE - WINDOW / 2) / HOP);
    const to = Math.round((seg.end * RATE - WINDOW / 2) / HOP);
    for (let t = Math.max(0, from); t < Math.min(frames, to); t++) {
      labels[t] = label;
      states[t] = Math.min(
        2,
        Math.floor((3 * (t - from)) / Math.max(1, to - from))
      );
    }
  }
  return { labels, states };
}

export function referencePhones(plan) {
  return plan.segments
    .filter((s) => s.kind === 'vowel' || s.kind === 'consonant')
    .map((s) => s.token.symbol);
}

/** Random sentence from the word counts with bigram continuation. */
export function sampleSentence(
  lang,
  random,
  words = 3 + Math.floor(random() * 6)
) {
  const { words: list } = getCounts(lang);
  const top = list.slice(0, 4000);
  const total = top.reduce((s, w) => s + Math.sqrt(w.count), 0);
  const pick = () => {
    let r = random() * total;
    for (const w of top) {
      r -= Math.sqrt(w.count);
      if (r <= 0) {
        return w.word;
      }
    }
    return top[0].word;
  };
  const out = Array.from({ length: words }, pick);
  const marks =
    lang === 'zh'
      ? ['。', '？', '！', '，']
      : lang === 'hi'
        ? ['।', '?', '!']
        : ['.', '?', '!'];
  const mark = marks[Math.floor(random() * marks.length)];
  if (lang === 'zh') {
    return out.join('') + mark;
  }
  return out.join(' ') + mark;
}

export { createRandom };
