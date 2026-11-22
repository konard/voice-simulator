/* eslint-disable complexity */
/**
 * Gaussian mixture state models over cepstral frames and a phone-loop
 * Viterbi decoder with a phone bigram. Unlicense.
 */
import { readFileSync } from 'node:fs';
import { RATE } from './issue-75-hmm-lib.mjs';

const HOP = 80;
const WINDOW = 200;

export function decodeFeats(text) {
  if (typeof text !== 'string') {
    return text;
  }
  const b = Buffer.from(text, 'base64');
  return new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.length)
  );
}

export function itemDim(item) {
  return decodeFeats(item.feats).length / item.frames;
}

export function loadItems(files, filter = () => true) {
  return files
    .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')))
    .filter(filter);
}

export function fitGmm(frames, k) {
  const n = frames.length;
  const D = frames[0].length;
  const kk = Math.min(k, Math.max(1, Math.floor(n / 40)));
  const gm = new Float64Array(D);
  const gv = new Float64Array(D);
  for (const x of frames) {
    for (let d = 0; d < D; d++) {
      gm[d] += x[d] / n;
    }
  }
  for (const x of frames) {
    for (let d = 0; d < D; d++) {
      gv[d] += (x[d] - gm[d]) ** 2 / n;
    }
  }
  const comps = Array.from({ length: kk }, (_, c) => ({
    w: 1 / kk,
    mu: Float64Array.from(frames[Math.floor(((c + 0.5) * n) / kk)]),
    var: Float64Array.from(gv, (v) => Math.max(v, 1e-3)),
  }));
  const prepare = () => {
    for (const c of comps) {
      c.norm =
        -0.5 * c.var.reduce((s, v) => s + Math.log(2 * Math.PI * v), 0) +
        Math.log(c.w);
      c.inv = Float64Array.from(c.var, (v) => 0.5 / v);
    }
  };
  const resp = new Float64Array(kk);
  for (let iter = 0; iter < 8; iter++) {
    prepare();
    const acc = comps.map(() => ({
      n: 0,
      s: new Float64Array(D),
      q: new Float64Array(D),
    }));
    for (const x of frames) {
      let max = -Infinity;
      for (let c = 0; c < kk; c++) {
        resp[c] = gauss(comps[c], x);
        max = Math.max(max, resp[c]);
      }
      let sum = 0;
      for (let c = 0; c < kk; c++) {
        resp[c] = Math.exp(resp[c] - max);
        sum += resp[c];
      }
      for (let c = 0; c < kk; c++) {
        const r = resp[c] / sum;
        const a = acc[c];
        a.n += r;
        for (let d = 0; d < D; d++) {
          a.s[d] += r * x[d];
          a.q[d] += r * x[d] * x[d];
        }
      }
    }
    comps.forEach((c, i) => {
      const a = acc[i];
      if (a.n < 1) {
        return;
      }
      c.w = a.n / n;
      for (let d = 0; d < D; d++) {
        c.mu[d] = a.s[d] / a.n;
        c.var[d] = Math.max(a.q[d] / a.n - c.mu[d] ** 2, 0.02 * gv[d] + 1e-4);
      }
    });
  }
  prepare();
  return comps;
}

function gauss(c, x) {
  let s = c.norm;
  const { mu } = c;
  for (let d = 0; d < mu.length; d++) {
    const e = x[d] - mu[d];
    s -= e * e * c.inv[d];
  }
  return s;
}

export function gmmScore(gmm, x) {
  let max = -Infinity;
  const parts = gmm.map((c) => {
    const s = gauss(c, x);
    if (s > max) {
      max = s;
    }
    return s;
  });
  let sum = 0;
  for (const p of parts) {
    sum += Math.exp(p - max);
  }
  return max + Math.log(sum);
}

/** Estimate state mixtures, durations and a phone bigram from labelled items. */
export function trainModel(items, { K = 8, unitOf = (label) => label } = {}) {
  const pools = new Map();
  const durations = new Map();
  const bigram = new Map();
  const D = itemDim(items[0]);
  for (const item of items) {
    const f = decodeFeats(item.feats);
    let prev = 'sil';
    let run = 0;
    for (let t = 0; t < item.frames; t++) {
      const label = unitOf(item.labels[t], item);
      const key = `${label}#${item.states[t]}`;
      if (!pools.has(key)) {
        pools.set(key, []);
      }
      pools.get(key).push(f.subarray(t * D, t * D + D));
      if (label !== prev) {
        const pair = `${prev} ${label}`;
        bigram.set(pair, (bigram.get(pair) ?? 0) + 1);
        const d = durations.get(prev) ?? [0, 0];
        durations.set(prev, [d[0] + run, d[1] + 1]);
        prev = label;
        run = 0;
      }
      run++;
    }
  }
  const units = [
    ...new Set([...pools.keys()].map((k) => k.split('#')[0])),
  ].sort();
  const models = new Map();
  for (const [key, frames] of pools) {
    models.set(key, fitGmm(frames, K));
  }
  const states = [];
  for (const u of units) {
    const [frames, n] = durations.get(u) ?? [9, 3];
    const mean = Math.max(3, frames / n);
    for (let s = 0; s < 3; s++) {
      states.push({
        unit: u,
        s,
        model:
          models.get(`${u}#${s}`) ??
          models.get(`${u}#1`) ??
          models.get(`${u}#0`) ??
          models.get(`${u}#2`),
        stay: Math.log(1 - 3 / mean),
        go: Math.log(3 / mean),
      });
    }
  }
  const outCount = new Map();
  for (const [k, v] of bigram) {
    const [a] = k.split(' ');
    outCount.set(a, (outCount.get(a) ?? 0) + v);
  }
  return { units, states, bigram, outCount };
}

export function phoneLoop(model, { lmw = 1, penalty = 0 } = {}) {
  const { units, bigram, outCount } = model;
  return units.map((a) =>
    Float64Array.from(
      units,
      (b) =>
        lmw *
          Math.log(
            ((bigram.get(`${a} ${b}`) ?? 0) + 0.1) /
              ((outCount.get(a) ?? 0) + 0.1 * units.length)
          ) -
        penalty
    )
  );
}

export function emissions(model, feats) {
  const S = model.states.length;
  return feats.map((x) => {
    const e = new Float64Array(S);
    for (let i = 0; i < S; i++) {
      e[i] = gmmScore(model.states[i].model, x);
    }
    return e;
  });
}

/** Viterbi over the phone loop; returns unit runs with frame ranges. */
export function decodeLoop(model, lm, emit) {
  const { states, units } = model;
  const T = emit.length;
  const S = states.length;
  const U = units.length;
  const sil = units.indexOf('sil');
  let prev = new Float64Array(S).fill(-Infinity);
  const back = [];
  for (let t = 0; t < T; t++) {
    const e = emit[t];
    const cur = new Float64Array(S).fill(-Infinity);
    const bp = new Int32Array(S).fill(-1);
    if (t === 0) {
      for (let u = 0; u < U; u++) {
        cur[u * 3] = e[u * 3] + (sil >= 0 ? lm[sil][u] : 0);
      }
    } else {
      for (let v = 0; v < U; v++) {
        let best = -Infinity;
        let arg = -1;
        for (let u = 0; u < U; u++) {
          const sc = prev[u * 3 + 2] + states[u * 3 + 2].go + lm[u][v];
          if (sc > best) {
            best = sc;
            arg = u * 3 + 2;
          }
        }
        const i = v * 3;
        const self = prev[i] + states[i].stay;
        if (self >= best) {
          cur[i] = self + e[i];
          bp[i] = i;
        } else {
          cur[i] = best + e[i];
          bp[i] = arg;
        }
        for (let s = 1; s < 3; s++) {
          const j = i + s;
          const a = prev[j] + states[j].stay;
          const b = prev[j - 1] + states[j - 1].go;
          cur[j] = Math.max(a, b) + e[j];
          bp[j] = a >= b ? j : j - 1;
        }
      }
    }
    back.push(bp);
    prev = cur;
  }
  let best = -Infinity;
  let at = -1;
  for (let u = 0; u < U; u++) {
    if (prev[u * 3 + 2] > best) {
      best = prev[u * 3 + 2];
      at = u * 3 + 2;
    }
  }
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = at;
    at = back[t][at];
  }
  const runs = [];
  for (let t = 0; t < T; t++) {
    const st = path[t];
    const entered = t === 0 || (st % 3 === 0 && path[t - 1] !== st);
    if (entered) {
      runs.push({ unit: states[st].unit, from: t, to: t + 1 });
    } else {
      runs.at(-1).to = t + 1;
    }
  }
  return { runs, path, score: best };
}

export function frameTime(t) {
  return (t * HOP + WINDOW / 2) / RATE;
}

/** Runs to timed sounds: releases merge into their closure. */
export function timedSounds(runs) {
  const out = [];
  for (const run of runs) {
    const start = frameTime(run.from);
    const end = frameTime(run.to);
    if (run.unit === 'sil') {
      out.push({ ipa: '', kind: 'pause', start, end });
      continue;
    }
    if (run.unit.endsWith('_r')) {
      const base = run.unit.slice(0, -2);
      const last = out.at(-1);
      if (last?.ipa === base) {
        last.end = end;
        continue;
      }
      out.push({ ipa: base, kind: 'consonant', start, end });
      continue;
    }
    out.push({ ipa: run.unit, kind: 'sound', start, end });
  }
  return out;
}
