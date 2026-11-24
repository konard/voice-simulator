/**
 * Would a separate tone stream tell Mandarin tones apart better than the
 * shipped acoustic model? Fits small GMMs of long-window pitch features
 * (height, slopes over ±5 and ±10 frames, curvature, height against the
 * ±30-frame mean, voicing) per tone class and state on the stored training
 * audio, then classifies the tone of every toned vowel of the fixed test
 * sentences, at the reference frame labels, by
 *   model  — the summed best context-independent state score of the vowel
 *            with each tone in the shipped model;
 *   stream — the tone stream alone;
 *   both   — model + W · stream.
 * node experiments/issue-75-tone-stream-probe.mjs <zh-train.json...>
 * Environment: K (8), W (1), TIER (telephone), PRESET (male), TO (20).
 * Unlicense.
 */
import { readFileSync } from 'node:fs';
import { synthesize } from '../src/index.js';
import {
  hmmAudio,
  hmmFeatures,
  hmmStatics,
} from '../src/recognition/hmm-features.js';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';
import { HMM_TONE_DIMS, hmmToneFeatures } from '../src/recognition/hmm-tone.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels, pitchStatics } from './issue-75-hmm-lib.mjs';
import { fitGmm, gmmScore } from './issue-75-hmm-model.mjs';

const env = process.env;
const K = Number(env.K ?? 8);
const WS = (env.W ?? '1').split(',').map(Number);
const W = WS[0];
const files = process.argv.slice(2);

/** Tone-stream features (src/recognition/hmm-tone.js) as rows. */
function toneFeatures(lf0, voicing) {
  const flat = hmmToneFeatures(lf0, voicing);
  return Array.from({ length: lf0.length }, (_, t) =>
    flat.subarray(t * HMM_TONE_DIMS, (t + 1) * HMM_TONE_DIMS)
  );
}

const classOf = (label) => Number(/@(\d)$/u.exec(label)?.[1] ?? 0);
const pools = new Map();
for (const file of files) {
  for (const item of JSON.parse(readFileSync(file, 'utf8'))) {
    const b = Buffer.from(item.audio, 'base64');
    const pcm = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
    const x = Float32Array.from(pcm, (v) => v / 32767);
    const { lf0, voicing } = pitchStatics(x, item.frames);
    const f = toneFeatures(lf0, voicing);
    for (let t = 0; t < item.frames; t++) {
      const c = classOf(item.labels[t]);
      const key = c ? `${c}#${item.states[t]}` : '0';
      if (!pools.has(key)) {
        pools.set(key, []);
      }
      pools.get(key).push(f[t]);
    }
  }
}
const gmms = new Map(
  [...pools].map(([key, frames]) => [key, fitGmm(frames, K)])
);
console.log('pools', [...pools].map(([k, v]) => `${k}:${v.length}`).join(' '));

const model = getHmmModel();
const tally = { model: 0, stream: 0, both: 0, total: 0 };
const confusion = { model: new Map(), both: new Map() };
const note = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
for (let i = 0; i < Number(env.TO ?? 20); i++) {
  const spoken = synthesize(sentences.zh[i], {
    lang: 'zh',
    tier: env.TIER ?? 'telephone',
    preset: env.PRESET ?? 'male',
    head: 'random',
    seed: 1,
  });
  const { feats, frames } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const { statics } = hmmStatics(hmmAudio(spoken.samples, spoken.sampleRate));
  const tf = toneFeatures(
    statics.map((v) => v[13] / 4),
    statics.map((v) => v[14])
  );
  const { labels } = frameLabels(spoken.plan, frames, { tones: true });
  for (let t = 0; t < frames; ) {
    let end = t + 1;
    while (end < frames && labels[end] === labels[t]) {
      end++;
    }
    const truth = classOf(labels[t]);
    if (truth) {
      const vowel = labels[t].replace(/@\d$/u, '');
      const scores = [];
      for (let c = 1; c <= 5; c++) {
        const unit = model.units.indexOf(`${vowel}@${c}`);
        if (unit < 0) {
          continue;
        }
        let m = 0;
        let s = 0;
        for (let j = t; j < end; j++) {
          m += Math.max(
            ...[0, 1, 2].map((k) =>
              stateScore(3 * unit + k, feats, j * model.dims, model)
            )
          );
          s += Math.max(
            ...[0, 1, 2]
              .map((k) => gmms.get(`${c}#${k}`))
              .filter(Boolean)
              .map((g) => gmmScore(g, tf[j]))
          );
        }
        scores.push({ c, m, s });
      }
      const best = (f) => scores.reduce((a, b) => (f(b) > f(a) ? b : a)).c;
      const pick = {
        model: best((x) => x.m),
        stream: best((x) => x.s),
        both: best((x) => x.m + W * x.s),
      };
      for (const k of ['model', 'stream', 'both']) {
        tally[k] += Number(pick[k] === truth);
      }
      for (const w of WS) {
        const k = `W=${w}`;
        tally[k] =
          (tally[k] ?? 0) + Number(best((x) => x.m + w * x.s) === truth);
      }
      note(confusion.model, `${truth}→${pick.model}`);
      note(confusion.both, `${truth}→${pick.both}`);
      tally.total++;
    }
    t = end;
  }
}
const rate = (k) => (tally[k] / tally.total).toFixed(3);
console.log(
  `tone right of ${tally.total} vowels: model ${rate('model')} stream ${rate('stream')} both(W=${W}) ${rate('both')}`
);
console.log(`  ${WS.map((w) => `W=${w} ${rate(`W=${w}`)}`).join(', ')}`);
for (const [k, map] of Object.entries(confusion)) {
  console.log(
    `  ${k} ${[...map]
      .filter(([key]) => key[0] !== key.at(-1))
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => `${key}:${n}`)
      .join(' ')}`
  );
}
