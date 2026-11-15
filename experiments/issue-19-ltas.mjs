// Issue 19: long-term average spectrum (dB per mel band, relative to the
// total, over the frames within 30 dB of the loudest) of a recording and of
// the synthetic voice on some tiers, plus the voice's sample rate.
//
//   node experiments/issue-19-ltas.mjs <id> [tiers comma list]
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';
import { melFilterbank, powerFrames } from '../src/metrics/index.js';
import { trimSilence } from '../src/metrics/compare.js';

const [id, tierList = 'minimal,medium'] = process.argv.slice(2);
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const u = manifest.utterances.find((x) => x.id === id);
const reference = decodeFlac(
  new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
);
const filters = melFilterbank(26, 512, 16000);
function ltas(x, rate) {
  const s = trimSilence(rate === 16000 ? x : resample(x, rate, 16000), 16000);
  const frames = powerFrames(s, 16000);
  const totals = frames.map((p) => p.reduce((a, b) => a + b, 0));
  const top = Math.max(...totals);
  const sum = new Array(26).fill(0);
  frames.forEach((p, t) => {
    if (totals[t] > top * 1e-3) {
      filters.forEach((w, m) => {
        sum[m] += w.reduce((a, v, k) => a + v * p[k], 0);
      });
    }
  });
  const all = sum.reduce((a, b) => a + b, 0);
  return sum
    .map((v) => (10 * Math.log10(v / all)).toFixed(0).padStart(4))
    .join('');
}
console.log(
  'band centres Hz',
  filters
    .map((w) => {
      let k = 0;
      for (let i = 0; i < w.length; i++) {
        if (w[i] > w[k]) {
          k = i;
        }
      }
      return String(Math.round(k * 31.25)).padStart(5);
    })
    .join('')
);
console.log(
  `${'reference'.padEnd(10)} ${reference.sampleRate}`,
  ltas(reference.samples, reference.sampleRate)
);
for (const tier of tierList.split(',')) {
  const t0 = performance.now();
  const v = synthesize(u.text, {
    lang: u.lang,
    tier,
    seed: 1,
    head: presetHeadConfig('female'),
  });
  console.log(
    `${tier.padEnd(10)} ${v.sampleRate}`,
    ltas(v.samples, v.sampleRate),
    `${((performance.now() - t0) / 1000).toFixed(1)} s`
  );
}
