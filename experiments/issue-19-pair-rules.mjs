// Issue 19: MCD of the minimal tier and of the noise anchor, per language
// (mean over the golden utterances), when the frame pairs along the DTW
// path are kept by different rules:
//   both<T>: skip a pair when both frames are T dB below their loudest
//            frame (the rule of issue 18 with T = 40);
//   ref<T>:  skip a pair when the reference frame is T dB below its
//            loudest frame (the reference is not speech there).
//
//   node experiments/issue-19-pair-rules.mjs [tier] [limit per language]
import { readFileSync } from 'node:fs';
import {
  createRandom,
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';
import { dtw, mfcc, powerFrames } from '../src/metrics/index.js';
import { normalizeRms } from '../src/metrics/distortion.js';
import { trimSilence } from '../src/metrics/compare.js';

const tier = process.argv[2] || 'minimal';
const limit = Number(process.argv[3] || 6);
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const prep = (x, rate) =>
  normalizeRms(
    trimSilence(rate === 16000 ? x : resample(x, rate, 16000), 16000),
    0.1
  );
const levels = (x) => {
  const t = powerFrames(x, 16000).map((p) => p.reduce((s, v) => s + v, 0));
  const top = Math.max(...t);
  return t.map((v) => 10 * Math.log10(v / top));
};
const rules = {
  both40: [40, 'both'],
  ref40: [40, 'ref'],
  ref30: [30, 'ref'],
  ref25: [25, 'ref'],
  ref20: [20, 'ref'],
};
const totals = {};
for (const lang of ['en', 'ru', 'hi', 'zh']) {
  for (const u of manifest.utterances
    .filter((x) => x.lang === lang)
    .slice(0, limit)) {
    const reference = decodeFlac(
      new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
    );
    const voice = synthesize(u.text, {
      lang,
      tier,
      seed: 1,
      head: presetHeadConfig('female'),
    });
    const random = createRandom(1);
    const noise = Float64Array.from(reference.samples, () => 2 * random() - 1);
    const ref = prep(reference.samples, 16000);
    const cR = mfcc(ref, 16000);
    const lR = levels(ref);
    for (const [name, x, rate] of [
      [tier, voice.samples, voice.sampleRate],
      ['noise', noise, 16000],
    ]) {
      const tst = prep(x, rate);
      const cT = mfcc(tst, 16000);
      const lT = levels(tst);
      const { path } = dtw(
        cR.map((c) => c.subarray(1)),
        cT.map((c) => c.subarray(1))
      );
      for (const [rule, [db, kind]] of Object.entries(rules)) {
        const key = `${lang} ${name} ${rule}`;
        (totals[key] ??= []).push(
          meanMcd(path, cR, cT, (i, j) => {
            const silentR = lR[i] < -db;
            const silentT = lT[j] < -db;
            return kind === 'both' ? silentR && silentT : silentR;
          })
        );
      }
    }
  }
}
function meanMcd(path, cR, cT, skip) {
  let sum = 0;
  let n = 0;
  for (const [i, j] of path) {
    if (skip(i, j)) {
      continue;
    }
    let sq = 0;
    for (let k = 1; k < 14; k++) {
      sq += (cR[i][k] - cT[j][k]) ** 2;
    }
    sum += (10 / Math.LN10) * Math.sqrt(2 * sq);
    n++;
  }
  return sum / n;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
console.log(
  `tier ${tier}, ${limit} utterances per language; mean MCD tier / noise per rule`
);
for (const lang of ['en', 'ru', 'hi', 'zh']) {
  console.log(
    lang,
    Object.keys(rules)
      .map(
        (rule) =>
          `${rule} ${mean(totals[`${lang} ${tier} ${rule}`]).toFixed(1)}/${mean(totals[`${lang} noise ${rule}`]).toFixed(1)}`
      )
      .join('  ')
  );
}
