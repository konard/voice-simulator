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
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';

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

/** Speech at the model rate. */
export function modelAudio(samples, sampleRate) {
  return sampleRate === RATE ? samples : resample(samples, sampleRate, RATE);
}

/**
 * Pitch statics per frame: log2 f0 minus the utterance median of the
 * voiced frames, interpolated across unvoiced frames, and the voicing.
 */
export function pitchStatics(x, count) {
  const frames = analyzeFrames(x, RATE, { hop: 0.01 });
  const p = trackPitch(frames);
  const lf0 = new Float64Array(count).fill(NaN);
  const voicing = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const time = (t * HOP + WINDOW / 2) / RATE;
    const i = Math.round((time - p.startTime) / p.hop);
    if (i >= 0 && i < p.count) {
      voicing[t] = p.voicing[i];
      if (p.f0[i] > 0 && p.voicing[i] > 0.5) {
        lf0[t] = Math.log2(p.f0[i]);
      }
    }
  }
  const voiced = [...lf0].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const median = voiced.length ? voiced[voiced.length >> 1] : 0;
  // PITCH_RANGE=1 drops a pitch more than an octave from the median, as
  // src/recognition/hmm-features.js does at decode time. The shipped model
  // was trained without it (0, the default): training with it measured worse.
  const range = Number(globalThis.process?.env.PITCH_RANGE ?? 0);
  for (let t = 0; range > 0 && t < count; t++) {
    if (Math.abs(lf0[t] - median) > range) {
      lf0[t] = NaN;
    }
  }
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

/** Log mel cepstra c0..c12 with CMN of c1.., c0 relative to the max, plus deltas. */
export function features(samples, sampleRate, { pitch = false } = {}) {
  const x = modelAudio(samples, sampleRate);
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
  let statics = base;
  if (pitch) {
    const { lf0, voicing } = pitchStatics(x, base.length);
    statics = base.map((c, t) => {
      const v = new Float64Array(CEPS + 2);
      v.set(c);
      v[CEPS] = 4 * lf0[t];
      v[CEPS + 1] = voicing[t];
      return v;
    });
  }
  const S = statics[0]?.length ?? CEPS;
  return statics.map((c, t) => {
    const v = new Float32Array(2 * S);
    v.set(c);
    const a = statics[Math.max(0, t - 2)];
    const b = statics[Math.max(0, t - 1)];
    const d = statics[Math.min(statics.length - 1, t + 1)];
    const e = statics[Math.min(statics.length - 1, t + 2)];
    for (let n = 0; n < S; n++) {
      v[S + n] = (2 * (e[n] - a[n]) + (d[n] - b[n])) / 10;
    }
    return v;
  });
}

/** Tone class of a token tone: 1 level, 2 rising, 3 low, 4 falling, 0 none. */
export function toneClass(tone) {
  if (!tone?.length) {
    return 0;
  }
  const [a] = tone;
  const b = tone.at(-1);
  if (tone.length === 3 || (a <= 2 && b <= 2)) {
    return 3;
  }
  return b > a ? 2 : b < a ? 4 : 1;
}

/**
 * Unit names of a token list: vowels of a toned syllable (the toned vowel
 * and the vowels right before it) take the tone class, as "a@4".
 */
export function toneUnits(tokens) {
  const units = tokens.map((t) => t.symbol);
  for (let i = 0; i < tokens.length; i++) {
    const c = toneClass(tokens[i].tone);
    if (!c) {
      continue;
    }
    for (let j = i; j >= 0 && tokens[j].kind === 'vowel'; j--) {
      if (j < i && tokens[j].tone?.length) {
        break;
      }
      units[j] = `${tokens[j].symbol}@${c}`;
    }
  }
  return units;
}

/** Unit name of every plan token (Map token → unit). */
export function planTokenUnits(plan, tones) {
  const tokens = [];
  for (const seg of plan.segments) {
    if (seg.kind !== 'pause' && seg.token !== tokens.at(-1)) {
      tokens.push(seg.token);
    }
  }
  const units = tones ? toneUnits(tokens) : tokens.map((t) => t.symbol);
  return new Map(tokens.map((t, i) => [t, units[i]]));
}

/** Frame labels from the plan segments: phone symbol and third of segment. */
export function frameLabels(plan, frames, { tones = false } = {}) {
  const unitOf = planTokenUnits(plan, tones);
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
  let previous;
  for (const seg of segments) {
    let label;
    if (seg.kind === 'pause') {
      label = 'sil';
    } else if (seg.kind === 'release' || seg.token === previous) {
      // Stop releases and the frication of affricates.
      label = `${unitOf.get(seg.token)}_r`;
    } else {
      label = unitOf.get(seg.token);
    }
    previous = seg.token;
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

/** Units of each spoken token, e.g. "k k_r" for a released stop. */
export function tokenUnits(plan, { tones = false } = {}) {
  const unitOf = planTokenUnits(plan, tones);
  const out = [];
  let previous;
  for (const seg of plan.segments) {
    if (seg.kind === 'pause') {
      previous = undefined;
      continue;
    }
    if (seg.token === previous) {
      out[out.length - 1] += ` ${unitOf.get(seg.token)}_r`;
    } else {
      out.push(unitOf.get(seg.token));
    }
    previous = seg.token;
  }
  return out;
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
