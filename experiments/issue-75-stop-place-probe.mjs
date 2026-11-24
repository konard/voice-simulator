/**
 * Does stop place (p t k b d ɡ) improve with more training data or with
 * short-window burst features? Trains context-independent 3-state GMMs on
 * the statics of the stored 8 kHz training audio (LDA over ±CTX frames),
 * then classifies every stop segment of the fixed test sentences by the
 * summed best-state log likelihood of its frames among the six stops.
 * node experiments/issue-75-stop-place-probe.mjs <lang> <train.json...>
 * Environment: FEATURE (base | burst), K (16), LDA (40), CTX (4),
 * TIER (telephone), PRESET (male), TO (20 test sentences); SHIPPED=1 scores
 * the context-independent states of the shipped model instead (no files).
 * Unlicense.
 */
import { readFileSync } from 'node:fs';
import { synthesize } from '../src/index.js';
import {
  hmmAudio,
  hmmFeatures,
  hmmStatics,
} from '../src/recognition/hmm-features.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels } from './issue-75-hmm-lib.mjs';
import { fitLda, applyLda } from './issue-75-hmm-lda.mjs';
import { fitGmm, gmmScore } from './issue-75-hmm-model.mjs';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';

const [lang, ...files] = process.argv.slice(2);
const env = process.env;
const FEATURE = env.FEATURE ?? 'base';
const K = Number(env.K ?? 16);
const STOPS = (env.STOPS ?? 'p,t,k,b,d,ɡ').split(',');
const HOP = 80;
const SUB = 32;

/** Burst shape: the loudest 4 ms slice of the hop, as 4 band log energies
 * minus their mean, and its level against the frame's mean slice level. */
function burst(x, frames) {
  const out = [];
  const bins = SUB / 2;
  for (let t = 0; t < frames; t++) {
    let best = null;
    let total = 0;
    let n = 0;
    for (let o = t * HOP + 60; o + SUB <= t * HOP + 140; o += SUB / 4) {
      const power = new Float64Array(bins);
      for (let k = 1; k <= bins; k++) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < SUB; i++) {
          const v = (x[o + i] ?? 0) - 0.97 * (x[o + i - 1] ?? 0);
          re += v * Math.cos((2 * Math.PI * k * i) / SUB);
          im -= v * Math.sin((2 * Math.PI * k * i) / SUB);
        }
        power[k - 1] = re * re + im * im;
      }
      const e = power.reduce((a, b) => a + b, 0);
      total += Math.log(e + 1e-10);
      n++;
      if (!best || e > best.e) {
        best = { e, power };
      }
    }
    // 250 Hz bins: 250-1000, 1000-2000, 2000-3000, 3000-4000 Hz.
    const band = (a, b) =>
      Math.log(best.power.slice(a, b).reduce((s, v) => s + v, 0) + 1e-10);
    const bands = [band(0, 4), band(4, 8), band(8, 12), band(12, 16)];
    const mean = bands.reduce((a, b) => a + b, 0) / 4;
    out.push([
      ...bands.map((b) => b - mean),
      Math.log(best.e + 1e-10) - total / n,
    ]);
  }
  return out;
}

/** Statics (and burst extras) as a flat layout that stack() reads: dim = 2S. */
function featurize(x) {
  const { statics } = hmmStatics(x);
  const frames = statics.length;
  const extra = FEATURE === 'burst' ? burst(x, frames) : null;
  const S = statics[0].length + (extra ? extra[0].length : 0);
  const feats = new Float32Array(frames * 2 * S);
  for (let t = 0; t < frames; t++) {
    const row = extra ? [...statics[t], ...extra[t]] : statics[t];
    feats.set(row, t * 2 * S);
  }
  return { feats, frames, dim: 2 * S };
}

const shipped = env.SHIPPED === '1' ? getHmmModel() : null;
const items = [];
for (const file of shipped ? [] : files) {
  for (const item of JSON.parse(readFileSync(file, 'utf8'))) {
    const b = Buffer.from(item.audio, 'base64');
    const pcm = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
    const { feats, frames, dim } = featurize(
      Float32Array.from(pcm, (v) => v / 32767)
    );
    const n = Math.min(frames, item.frames);
    items.push({
      feats,
      frames: n,
      dim,
      labels: item.labels.slice(0, n),
      states: item.states.slice(0, n),
    });
  }
}
const dim = items[0]?.dim;
const lda =
  !shipped &&
  fitLda(
    items.filter((_, i) => i % 4 === 0),
    { dims: Number(env.LDA ?? 40), ctx: Number(env.CTX ?? 4), dim }
  );
const pools = new Map();
for (const item of shipped ? [] : items) {
  const f = applyLda(lda, item.feats, item.frames);
  const D = lda.rows.length;
  for (let t = 0; t < item.frames; t++) {
    const key = `${item.labels[t]}#${item.states[t]}`;
    if (!pools.has(key)) {
      pools.set(key, []);
    }
    pools.get(key).push(f.subarray(t * D, t * D + D));
  }
}
// Context-independent states of the shipped model are 3 × unit + state.
const ciStates = (u) =>
  [0, 1, 2].map((k) => ({ shippedState: 3 * shipped.units.indexOf(u) + k }));
const models = new Map(
  STOPS.map((u) => [
    u,
    shipped
      ? ciStates(u)
      : [0, 1, 2]
          .map((s) => pools.get(`${u}#${s}`))
          .filter(Boolean)
          .map((frames) => fitGmm(frames, K)),
  ])
);
const confusion = new Map(STOPS.map((u) => [u, new Map()]));
let right = 0;
let total = 0;
for (let i = 0; i < Number(env.TO ?? 20); i++) {
  const spoken = synthesize(sentences[lang][i], {
    lang,
    tier: env.TIER ?? 'telephone',
    preset: env.PRESET ?? 'male',
    head: 'random',
    seed: 1,
  });
  const x = hmmAudio(spoken.samples, spoken.sampleRate);
  let f;
  let frames;
  let D;
  if (shipped) {
    ({ feats: f, frames } = hmmFeatures(
      spoken.samples,
      spoken.sampleRate,
      shipped.lda
    ));
    D = shipped.dims;
  } else {
    let feats;
    ({ feats, frames } = featurize(x));
    f = applyLda(lda, feats, frames);
    D = lda.rows.length;
  }
  const score1 = (g, j) =>
    g.shippedState === undefined
      ? gmmScore(g, f.subarray(j * D, j * D + D))
      : stateScore(g.shippedState, f, j * D, shipped);
  const { labels } = frameLabels(spoken.plan, frames);
  for (let t = 0; t < frames; ) {
    let end = t + 1;
    while (end < frames && labels[end] === labels[t]) {
      end++;
    }
    if (STOPS.includes(labels[t])) {
      let best = null;
      for (const [u, states] of models) {
        let score = 0;
        for (let j = t; j < end; j++) {
          score += Math.max(...states.map((g) => score1(g, j)));
        }
        if (!best || score > best.score) {
          best = { u, score };
        }
      }
      const row = confusion.get(labels[t]);
      row.set(best.u, (row.get(best.u) ?? 0) + 1);
      right += Number(best.u === labels[t]);
      if (best.u !== labels[t]) {
        console.log(`  sentence ${i} frame ${t}: ${labels[t]} → ${best.u}`);
      }
      total++;
    }
    t = end;
  }
}
console.log(
  `${lang} ${shipped ? 'shipped' : FEATURE} files ${files.length} items ${items.length}: stop place ${right}/${total} = ${(right / total).toFixed(2)}`
);
for (const [u, row] of confusion) {
  console.log(
    `  ${u}  ${[...row]
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}:${n}`)
      .join(' ')}`
  );
}
