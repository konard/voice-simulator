// Issue 19: per-pair mel-cepstral distance along the DTW path of
// compareRecordings, grouped by the level of the reference frame below the
// loudest frame of the reference. Shows whether quiet frames dominate MCD.
//
//   node experiments/issue-19-frame-levels.mjs <id> <tier|noise|lowpass> [range dB]
import { readFileSync } from 'node:fs';
import {
  createRandom,
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';
import { dtw, powerFrames, cepstra } from '../src/metrics/index.js';
import { normalizeRms } from '../src/metrics/distortion.js';
import { trimSilence } from '../src/metrics/compare.js';

const [id, kind, rangeArg] = process.argv.slice(2);
const range = Number(rangeArg || 60);
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const u = manifest.utterances.find((item) => item.id === id);
const ref = decodeFlac(
  new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
);
let test;
if (kind === 'noise') {
  const random = createRandom(1);
  test = {
    samples: Float64Array.from(ref.samples, () => 2 * random() - 1),
    sampleRate: 16000,
  };
} else if (kind === 'lowpass') {
  test = {
    samples: resample(resample(ref.samples, 16000, 7000), 7000, 16000),
    sampleRate: 16000,
  };
} else {
  test = synthesize(u.text, {
    lang: u.lang,
    tier: kind,
    seed: 1,
    head: presetHeadConfig('female'),
  });
}
const prep = (r) =>
  normalizeRms(
    trimSilence(
      r.sampleRate === 16000
        ? r.samples
        : resample(r.samples, r.sampleRate, 16000),
      16000
    ),
    0.1
  );
const xr = prep(ref);
const xt = prep(test);
const fr = powerFrames(xr, 16000);
const ft = powerFrames(xt, 16000);
const cr = cepstra(fr, 16000, { range });
const ct = cepstra(ft, 16000, { range });
const { path } = dtw(
  cr.map((c) => c.subarray(1)),
  ct.map((c) => c.subarray(1))
);
const level = (frames) => {
  const t = frames.map((p) => p.reduce((s, v) => s + v, 0));
  const max = Math.max(...t);
  return t.map((v) => 10 * Math.log10(Math.max(v, 1e-30) / max));
};
const lr = level(fr);
const lt = level(ft);
const buckets = new Map();
let total = 0;
for (const [i, j] of path) {
  if (lr[i] < -40 && lt[j] < -40) {
    continue;
  }
  let sum = 0;
  for (let n = 1; n < 14; n++) {
    sum += (cr[i][n] - ct[j][n]) ** 2;
  }
  const d = (10 / Math.LN10) * Math.sqrt(2 * sum);
  const key = Math.max(-6, Math.floor(lr[i] / 10));
  const b = buckets.get(key) || { n: 0, sum: 0 };
  b.n++;
  b.sum += d;
  total++;
  buckets.set(key, b);
}
console.log(
  `${id} vs ${kind}, range ${range}: reference level bucket (dB), pairs, mean MCD of the pairs`
);
let all = 0;
for (const key of [...buckets.keys()].sort((a, b) => b - a)) {
  const b = buckets.get(key);
  all += b.sum;
  console.log(
    `${String(key * 10).padStart(4)}..${String(key * 10 + 10).padStart(4)}  ${String(b.n).padStart(4)}  ${(b.sum / b.n).toFixed(1)}`
  );
}
console.log('MCD', (all / total).toFixed(1));
