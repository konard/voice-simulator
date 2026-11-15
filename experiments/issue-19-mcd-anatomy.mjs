// Issue 19: where the mel-cepstral distortion of a tier and of the two
// anchors comes from. Along the DTW path of compareRecordings, for the
// floored log mel energies (nepers): the signed mean difference test - ref
// per band, the RMS difference per band, and the share of the squared
// distance per cepstral coefficient c1..c13. Also the MCD when the pairs
// with a silent reference frame are left out.
//
//   node experiments/issue-19-mcd-anatomy.mjs <id> [tier] [range dB]
import { readFileSync } from 'node:fs';
import {
  createRandom,
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';
import {
  dtw,
  melFilterbank,
  powerFloor,
  powerFrames,
  mfcc,
} from '../src/metrics/index.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
import { trimSilence } from '../src/metrics/compare.js';

const [id, tier = 'minimal', rangeArg] = process.argv.slice(2);
const range = Number(rangeArg || 60);
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
const low = resample(resample(reference.samples, 16000, 7000), 7000, 16000);
const random = createRandom(1);
const noise = Float64Array.from(reference.samples, () => 2 * random() - 1);
const filters = melFilterbank(26, 512, 16000);
const prep = (x, rate) =>
  normalizeRms(
    trimSilence(rate === 16000 ? x : resample(x, rate, 16000), 16000),
    0.1
  );
function logMel(x) {
  const frames = powerFrames(x, 16000);
  const e = frames.map((p) =>
    filters.map((w) => w.reduce((s, v, k) => s + v * p[k], 0))
  );
  const floor = powerFloor(e, range);
  return {
    frames,
    L: e.map((row) => row.map((v) => Math.log(Math.max(v, floor)))),
  };
}
const ref = prep(reference.samples, 16000);
const R = logMel(ref);
const cR = mfcc(ref, 16000, { range }).map((c) => c.subarray(1));
const silentR = silentFrames(R.frames);
const f = (x, w = 6) => x.toFixed(1).padStart(w);
for (const [name, x, rate] of [
  [tier, voice.samples, voice.sampleRate],
  ['lowpass', low, 16000],
  ['noise', noise, 16000],
]) {
  const tst = prep(x, rate);
  const T = logMel(tst);
  const cT = mfcc(tst, 16000, { range }).map((c) => c.subarray(1));
  const silentT = silentFrames(T.frames);
  const { path } = dtw(cR, cT);
  const mean = new Array(26).fill(0);
  const sq = new Array(26).fill(0);
  const csq = new Array(13).fill(0);
  let n = 0;
  const variants = { both: [0, 0], ref: [0, 0], either: [0, 0] };
  for (const [i, j] of path) {
    let s = 0;
    for (let k = 0; k < 13; k++) {
      s += (cR[i][k] - cT[j][k]) ** 2;
    }
    const d = (10 / Math.LN10) * Math.sqrt(2 * s);
    if (!(silentR[i] && silentT[j])) {
      variants.both[0] += d;
      variants.both[1]++;
    }
    if (!silentR[i]) {
      variants.ref[0] += d;
      variants.ref[1]++;
    }
    if (!silentR[i] && !silentT[j]) {
      variants.either[0] += d;
      variants.either[1]++;
    }
    if (silentR[i] && silentT[j]) {
      continue;
    }
    n++;
    for (let m = 0; m < 26; m++) {
      const dl = T.L[j][m] - R.L[i][m];
      mean[m] += dl;
      sq[m] += dl * dl;
    }
    for (let k = 0; k < 13; k++) {
      csq[k] += (cR[i][k] - cT[j][k]) ** 2;
    }
  }
  const tot = csq.reduce((a, b) => a + b, 0);
  console.log(
    `\n${id} ${name}: pairs ${n}/${path.length}; MCD skip both-silent ${f(variants.both[0] / variants.both[1])}, skip ref-silent ${f(variants.ref[0] / variants.ref[1])}, skip either ${f(variants.either[0] / variants.either[1])}`
  );
  console.log(
    'band mean dB  ',
    mean.map((v) => f((v / n) * 4.343, 4)).join('')
  );
  console.log(
    'band rms dB   ',
    sq.map((v) => f(Math.sqrt(v / n) * 4.343, 4)).join('')
  );
  console.log('c1..c13 share%', csq.map((v) => f((100 * v) / tot, 4)).join(''));
}
