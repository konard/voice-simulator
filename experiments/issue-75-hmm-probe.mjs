/* eslint-disable complexity, max-statements, max-depth */
/**
 * Train Gaussian mixture state models on rendered utterances and decode the
 * round-trip corpus with a phone loop.
 * node experiments/issue-75-hmm-probe.mjs <lang> <tier> <K> <train.json...>
 * Unlicense.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/index.js';
import { editDistance } from '../src/metrics/text.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { features, frameLabels, referencePhones } from './issue-75-hmm-lib.mjs';

const [lang, tier = 'telephone', kArg = '4', ...files] = process.argv.slice(2);
const K = Number(kArg);
function decodeFeats(text) {
  const b = Buffer.from(text, 'base64');
  return new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.length)
  );
}
const D = 26;

const ONLY = process.env.ONLY;
const allData = files
  .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')))
  .filter((_, i) => ONLY === undefined || i % 4 === Number(ONLY));
const HOLD = Number(process.env.HOLD ?? 0);
const data = allData.slice(0, allData.length - HOLD);
const held = allData.slice(allData.length - HOLD);
const pools = new Map();
const durations = new Map();
const bigram = new Map();
for (const item of data) {
  const f = decodeFeats(item.feats);
  // Note: Buffer slices share memory; copy to align.
  let prev = 'sil';
  let run = 0;
  for (let t = 0; t < item.frames; t++) {
    const key = `${item.labels[t]}#${item.states[t]}`;
    if (!pools.has(key)) {
      pools.set(key, []);
    }
    pools.get(key).push(f.subarray(t * D, t * D + D));
    if (item.labels[t] !== prev) {
      bigram.set(
        `${prev} ${item.labels[t]}`,
        (bigram.get(`${prev} ${item.labels[t]}`) ?? 0) + 1
      );
      const d = durations.get(prev) ?? [0, 0];
      durations.set(prev, [d[0] + run, d[1] + 1]);
      prev = item.labels[t];
      run = 0;
    }
    run++;
  }
}
const units = [
  ...new Set([...pools.keys()].map((k) => k.split('#')[0])),
].sort();

function fitGmm(frames, k) {
  const n = frames.length;
  const comps = [];
  const kk = Math.min(k, Math.max(1, Math.floor(n / 40)));
  for (let c = 0; c < kk; c++) {
    comps.push({
      w: 1 / kk,
      mu: Float64Array.from(frames[Math.floor(((c + 0.5) * n) / kk)]),
      var: new Float64Array(D).fill(1),
    });
  }
  // global variance for floor
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
  for (const c of comps) {
    c.var = Float64Array.from(gv, (v) => Math.max(v, 1e-3));
  }
  const resp = new Float64Array(kk);
  for (let iter = 0; iter < 8; iter++) {
    const acc = comps.map(() => ({
      n: 0,
      s: new Float64Array(D),
      q: new Float64Array(D),
    }));
    for (const x of frames) {
      let max = -Infinity;
      for (let c = 0; c < kk; c++) {
        resp[c] = logGauss(comps[c], x) + Math.log(comps[c].w);
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
  for (const c of comps) {
    c.norm =
      -0.5 * c.var.reduce((s, v) => s + Math.log(2 * Math.PI * v), 0) +
      Math.log(c.w);
    c.inv = Float64Array.from(c.var, (v) => 0.5 / v);
  }
  return comps;
}

function logGauss(c, x) {
  let s =
    c.norm ?? -0.5 * c.var.reduce((a, v) => a + Math.log(2 * Math.PI * v), 0);
  for (let d = 0; d < D; d++) {
    s -= (x[d] - c.mu[d]) ** 2 / (2 * c.var[d]);
  }
  return s;
}

function score(gmm, x) {
  let max = -Infinity;
  const parts = gmm.map((c) => {
    let s = c.norm;
    for (let d = 0; d < D; d++) {
      const e = x[d] - c.mu[d];
      s -= e * e * c.inv[d];
    }
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

let t0 = performance.now();
const models = new Map();
for (const [key, frames] of pools) {
  models.set(key, fitGmm(frames, K));
}
console.log(
  lang,
  'units',
  units.length,
  'frames',
  data.reduce((s, d) => s + d.frames, 0),
  'train',
  ((performance.now() - t0) / 1000).toFixed(1),
  's'
);

// Transition model.
const states = [];
for (const u of units) {
  const [frames, n] = durations.get(u) ?? [9, 3];
  const mean = Math.max(3, frames / n);
  const stay = Math.log(1 - 3 / mean);
  const go = Math.log(3 / mean);
  for (let s = 0; s < 3; s++) {
    states.push({
      unit: u,
      s,
      model:
        models.get(`${u}#${s}`) ?? models.get(`${u}#1`) ?? models.get(`${u}#0`),
      stay,
      go,
    });
  }
}
const unitIndex = new Map(units.map((u, i) => [u, i]));
const outCount = new Map();
for (const [k, v] of bigram) {
  const [a] = k.split(' ');
  outCount.set(a, (outCount.get(a) ?? 0) + v);
}
const LMW = Number(process.env.LMW ?? 1);
const PEN = Number(process.env.PEN ?? 0);
const lm = units.map((a) =>
  units.map(
    (b) =>
      LMW *
        Math.log(
          ((bigram.get(`${a} ${b}`) ?? 0) + 0.1) /
            ((outCount.get(a) ?? 0) + 0.1 * units.length)
        ) -
      PEN
  )
);

function decode(feats) {
  const T = feats.length;
  const S = states.length;
  const U = units.length;
  let prev = new Float64Array(S).fill(-Infinity);
  const back = [];
  const emit = new Float64Array(S);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < S; i++) {
      emit[i] = score(states[i].model, feats[t]);
    }
    const cur = new Float64Array(S).fill(-Infinity);
    const bp = new Int32Array(S);
    if (t === 0) {
      for (let u = 0; u < U; u++) {
        cur[u * 3] = emit[u * 3] + lm[unitIndex.get('sil')][u];
      }
      back.push(bp.fill(-1));
      prev = cur;
      continue;
    }
    // best entry into each unit
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
        cur[i] = self + emit[i];
        bp[i] = i;
      } else {
        cur[i] = best + emit[i];
        bp[i] = arg;
      }
      for (let s = 1; s < 3; s++) {
        const j = i + s;
        const a = prev[j] + states[j].stay;
        const b = prev[j - 1] + states[j - 1].go;
        if (a >= b) {
          cur[j] = a + emit[j];
          bp[j] = j;
        } else {
          cur[j] = b + emit[j];
          bp[j] = j - 1;
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
  const seq = [];
  let last = -1;
  for (let t = 0; t < T; t++) {
    const st = path[t];
    if (st % 3 === 0 && (last === -1 || st !== last)) {
      if (
        last === -1 ||
        Math.floor(last / 3) !== Math.floor(st / 3) ||
        last % 3 === 2
      ) {
        seq.push(states[st].unit);
      }
    }
    last = st;
  }
  return { seq, path, score: best };
}

function collapse(seq) {
  const out = [];
  for (const u of seq) {
    if (u === 'sil') {
      continue;
    }
    if (u.endsWith('_r')) {
      const base = u.slice(0, -2);
      if (out.at(-1) === base) {
        continue;
      }
      out.push(base);
      continue;
    }
    out.push(u);
  }
  return out;
}

if (process.env.DIAG) {
  for (const [name, set] of [
    ['train', data.slice(0, 50)],
    ['held', held],
  ]) {
    let hit = 0;
    let n = 0;
    for (const item of set) {
      const f = decodeFeats(item.feats);
      for (let t = 0; t < item.frames; t++) {
        const x = f.subarray(t * D, t * D + D);
        let best = -Infinity;
        let arg = '';
        for (const st of states) {
          const sc = score(st.model, x);
          if (sc > best) {
            best = sc;
            arg = st.unit;
          }
        }
        hit += arg === item.labels[t];
        n++;
      }
    }
    console.log(name, 'frame argmax acc', (hit / Math.max(1, n)).toFixed(3), n);
  }
}
let edits = 0;
let total = 0;
let frameHits = 0;
let frameTotal = 0;
t0 = performance.now();
for (const preset of (process.env.TEST ?? 'male,female').split(',')) {
  for (const [index, text] of sentences[lang].entries()) {
    const spoken = synthesize(text, {
      lang,
      tier,
      head: 'random',
      preset,
      seed: 1,
    });
    const f = features(spoken.samples, spoken.sampleRate);
    const { labels } = frameLabels(spoken.plan, f.length);
    const { seq, path } = decode(f);
    for (let t = 0; t < f.length; t++) {
      frameTotal++;
      frameHits += states[path[t]].unit === labels[t];
    }
    const ref = referencePhones(spoken.plan);
    const hyp = collapse(seq);
    const e = editDistance(ref, hyp).distance;
    edits += e;
    total += ref.length;
    if (index < 3 || process.env.VERBOSE) {
      console.log(
        preset,
        index + 1,
        `${e}/${ref.length}`,
        ref.join(''),
        '→',
        hyp.join('')
      );
    }
  }
}
console.log(
  lang,
  tier,
  'K',
  K,
  'PER',
  (edits / total).toFixed(3),
  `${edits}/${total}`,
  'frame acc',
  (frameHits / frameTotal).toFixed(3),
  'decode',
  ((performance.now() - t0) / 1000).toFixed(1),
  's'
);
