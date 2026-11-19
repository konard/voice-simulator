import {
  CODEBOOK_CHANNELS,
  analyzeFrames,
  articulationPlan,
  invertArticulation,
  renderPlan,
} from '../src/index.js';

const render = (plan, item) =>
  renderPlan(plan, {
    sampleRate: item.sampleRate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });

export function baseline(item, head, book) {
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book }
  );
  return render(articulationPlan(track), item);
}

/** The reference itself: 0 dB sanity check. */
export function identity(item) {
  return item.samples;
}

import { readFileSync } from 'node:fs';
import { cepstra, powerFrames } from '../src/metrics/spectrum.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
import { tractSteps } from '../src/recognition/inversion-search.js';

const W = CODEBOOK_CHANNELS.length;
const C = 13;
const cacheDir = process.env.ISSUE150_CACHE || '/tmp/issue150-cache';
const templateCache = new Map();
function templatesFor(item) {
  let t = templateCache.get(item.speaker.id);
  if (!t) {
    const bytes = readFileSync(`${cacheDir}/${item.speaker.id}.templates.bin`);
    t = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    templateCache.set(item.speaker.id, t);
  }
  return t;
}

const K = Number(process.env.K ?? 24);
const LAMBDA = Number(process.env.LAMBDA ?? 1);

/** Per metric frame top-K rows by template MFCC distance, then Viterbi. */
export function templatePath(item, head, book) {
  const sr = item.sampleRate;
  const frames = powerFrames(normalizeRms(item.samples), sr);
  const cr = cepstra(frames, sr);
  const silent = silentFrames(frames);
  const templates = templatesFor(item);
  const rows = templates.length / C;
  const steps = tractSteps(head, 100);
  const weights = Float64Array.from(steps, (step, i) => {
    const { min, max } = CODEBOOK_CHANNELS[i];
    return LAMBDA * ((max - min) / (255 * step)) ** 2;
  });
  const table = book.articulation;
  const n = cr.length;
  const cand = [];
  for (let i = 0; i < n; i++) {
    if (silent[i]) {
      cand.push(null);
      continue;
    }
    const scores = new Float64Array(rows);
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = 0; k < C; k++) {
        const d = cr[i][k + 1] - templates[r * C + k];
        s += d * d;
      }
      scores[r] = s;
    }
    const order = Array.from({ length: rows }, (_, r) => r)
      .sort((a, b) => scores[a] - scores[b])
      .slice(0, K);
    // squared MCD units: 2 * (10/ln10)^2 * s
    cand.push(order.map((r) => ({ r, c: 2 * 18.86 * scores[r] })));
  }
  // Viterbi per speech stretch
  const choice = new Int32Array(n).fill(-1);
  let i = 0;
  while (i < n) {
    if (!cand[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && cand[j]) {
      j++;
    }
    const total = [cand[i].map((x) => x.c)];
    const back = [null];
    for (let t = i + 1; t < j; t++) {
      const prev = total[total.length - 1];
      const cur = [];
      const bp = [];
      for (const { r, c } of cand[t]) {
        let best = Infinity,
          arg = 0;
        cand[t - 1].forEach(({ r: q }, a) => {
          let m = 0;
          for (let ch = 0; ch < W; ch++) {
            const d = table[r * W + ch] - table[q * W + ch];
            m += d * d * weights[ch];
          }
          const v = prev[a] + m;
          if (v < best) {
            best = v;
            arg = a;
          }
        });
        cur.push(best + c);
        bp.push(arg);
      }
      total.push(cur);
      back.push(bp);
    }
    let a = total[total.length - 1].indexOf(
      Math.min(...total[total.length - 1])
    );
    for (let t = j - 1; t >= i; t--) {
      choice[t] = cand[t][a].r;
      if (back[t - i]) {
        a = back[t - i][a];
      }
    }
    i = j;
  }
  return choice;
}

export function templates(item, head, book) {
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book }
  );
  const choice = templatePath(item, head, book);
  for (let t = 0; t < track.frameCount; t++) {
    const i = Math.round((t * 0.005 - 0.0125) / 0.01);
    if (i < 0 || i >= choice.length || choice[i] < 0) {
      continue;
    }
    CODEBOOK_CHANNELS.forEach(({ name, min, max }, c) => {
      track.channels[name][t] =
        min + (book.articulation[choice[i] * W + c] / 255) * (max - min);
    });
  }
  return render(articulationPlan(track), item);
}

function templateTrack(item, head, book) {
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book }
  );
  const choice = templatePath(item, head, book);
  for (let t = 0; t < track.frameCount; t++) {
    const i = Math.round((t * 0.005 - 0.0125) / 0.01);
    if (i < 0 || i >= choice.length || choice[i] < 0) {
      continue;
    }
    CODEBOOK_CHANNELS.forEach(({ name, min, max }, c) => {
      track.channels[name][t] =
        min + (book.articulation[choice[i] * W + c] / 255) * (max - min);
    });
  }
  return track;
}

const KEEP = new Set((process.env.KEEP ?? 'loudness').split(','));
/** Template tract with a voiced source; KEEP lists inverted source channels kept. */
export function templatesVoiced(item, head, book) {
  const track = templateTrack(item, head, book);
  const flat = {
    voicing: 1,
    aspiration: 0,
    frication: 0,
    sibilance: 0,
    loudness: 1,
    f0: head.pitch,
    trill: 0,
  };
  for (const [name, value] of Object.entries(flat)) {
    if (!KEEP.has(name)) {
      track.channels[name].fill(value);
    }
  }
  return render(articulationPlan(track), item);
}
export function invertedVoiced(item, head, book) {
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book }
  );
  const flat = {
    voicing: 1,
    aspiration: 0,
    frication: 0,
    sibilance: 0,
    loudness: 1,
    f0: head.pitch,
    trill: 0,
  };
  for (const [name, value] of Object.entries(flat)) {
    if (!KEEP.has(name)) {
      track.channels[name].fill(value);
    }
  }
  return render(articulationPlan(track), item);
}

const ROUNDS = Number(process.env.ROUNDS ?? 3);
/** Render, compare frame levels with the recording, correct loudness, repeat. */
export function fitLevel(track, item) {
  const sr = item.sampleRate;
  const fr = powerFrames(normalizeRms(item.samples), sr);
  const sil = silentFrames(fr);
  const db = (f) => 10 * Math.log10(f.reduce((a, b) => a + b, 0) + 1e-20);
  const refDb = fr.map(db);
  let out = render(articulationPlan(track), item);
  for (let round = 0; round < ROUNDS; round++) {
    const ft = powerFrames(normalizeRms(out), sr);
    const delta = ft.map((f, i) =>
      i < fr.length && !sil[i]
        ? Math.max(-20, Math.min(20, refDb[i] - db(f)))
        : 0
    );
    for (let t = 0; t < track.frameCount; t++) {
      const x = (t * 0.005 - 0.0125) / 0.01;
      const a = Math.max(0, Math.min(delta.length - 1, Math.floor(x)));
      const b = Math.min(delta.length - 1, a + 1);
      const w = Math.max(0, Math.min(1, x - a));
      const d = (1 - w) * delta[a] + w * delta[b];
      track.channels.loudness[t] *= 10 ** (d / 20);
    }
    out = render(articulationPlan(track), item);
  }
  return out;
}
export function baselineLevel(item, head, book) {
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book }
  );
  return fitLevel(track, item);
}
export function templatesLevel(item, head, book) {
  return fitLevel(templateTrack(item, head, book), item);
}

/** Baseline with INV_OPTIONS (JSON) passed to invertArticulation. */
export function options(item, head, book) {
  const extra = JSON.parse(process.env.INV_OPTIONS ?? '{}');
  const track = invertArticulation(
    analyzeFrames(item.samples, item.sampleRate),
    { voice: head, codebook: book, ...extra }
  );
  return render(articulationPlan(track), item);
}
