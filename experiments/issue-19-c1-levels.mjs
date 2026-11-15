// Issue 19: distribution of c1 (spectral tilt) and of the frame level for
// the recording, a tier and white noise, and the mean MCD along the DTW
// path split by the level of the test frame (dB below its loudest frame).
//
//   node experiments/issue-19-c1-levels.mjs <id> [tier]
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

const [id, tier = 'minimal'] = process.argv.slice(2);
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const u = manifest.utterances.find((x) => x.id === id);
const reference = decodeFlac(
  new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
);
const voice = synthesize(u.text, {
  lang: u.lang,
  tier,
  seed: 1,
  head: presetHeadConfig('female'),
});
const random = createRandom(1);
const noise = Float64Array.from(reference.samples, () => 2 * random() - 1);
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
const pct = (a, ps) => {
  const s = [...a].sort((x, y) => x - y);
  return ps
    .map((p) => s[Math.floor(p * (s.length - 1))].toFixed(1).padStart(6))
    .join('');
};
const ref = prep(reference.samples, 16000);
const cR = mfcc(ref, 16000);
console.log('percentiles 10/25/50/75/90');
for (const [name, x, rate] of [
  ['reference', reference.samples, 16000],
  [tier, voice.samples, voice.sampleRate],
  ['noise', noise, 16000],
]) {
  const s = prep(x, rate);
  const c = mfcc(s, 16000);
  const lv = levels(s);
  console.log(
    `${name.padEnd(10)} c1 ${pct(
      c.map((v) => v[1]),
      [0.1, 0.25, 0.5, 0.75, 0.9]
    )}  level dB ${pct(lv, [0.1, 0.25, 0.5, 0.75, 0.9])}`
  );
  if (name === 'reference') {
    continue;
  }
  const { path } = dtw(
    cR.map((v) => v.subarray(1)),
    c.map((v) => v.subarray(1))
  );
  const buckets = new Map();
  for (const [i, j] of path) {
    let sq = 0;
    for (let k = 1; k < 14; k++) {
      sq += (cR[i][k] - c[j][k]) ** 2;
    }
    const key = `${Math.max(-60, Math.floor(lv[j] / 10) * 10)}`;
    const b = buckets.get(key) ?? [0, 0];
    b[0] += 4.343 * Math.sqrt(2 * sq);
    b[1]++;
    buckets.set(key, b);
  }
  console.log(
    '   MCD by test level:',
    [...buckets]
      .sort((a, b) => b[0] - a[0])
      .map(([k, [s, n]]) => `${k}: ${(s / n).toFixed(1)} (${n})`)
      .join(', ')
  );
}
