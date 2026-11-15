// Issue 19: noise floor of the golden recordings. For each file, after the
// silence trim and RMS normalisation of compareRecordings: the level of
// the quietest 5 % and 10 % of 25 ms frames and the 1st percentile of all
// mel filter energies, in dB below the strongest frame / filter energy.
//
//   node experiments/issue-19-noise-floor.mjs
import { readFileSync } from 'node:fs';
import { decodeFlac } from '../src/index.js';
import { melFilterbank, powerFrames } from '../src/metrics/index.js';
import { normalizeRms } from '../src/metrics/distortion.js';
import { trimSilence } from '../src/metrics/compare.js';

const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const filters = melFilterbank(26, 512, 16000);
const db = (x) => (10 * Math.log10(Math.max(x, 1e-30))).toFixed(1).padStart(7);
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log(
  'id     frames p5  frames p10  filters p1  filters p5  (dB below the maximum)'
);
for (const u of manifest.utterances) {
  const r = decodeFlac(
    new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
  );
  const x = normalizeRms(trimSilence(r.samples, 16000), 0.1);
  const frames = powerFrames(x, 16000);
  const totals = frames
    .map((p) => p.reduce((s, v) => s + v, 0))
    .sort((a, b) => a - b);
  const energies = frames
    .flatMap((p) => filters.map((w) => w.reduce((s, v, k) => s + v * p[k], 0)))
    .sort((a, b) => a - b);
  const top = totals.at(-1);
  const etop = energies.at(-1);
  console.log(
    u.id.padEnd(6),
    db(pct(totals, 0.05) / top),
    db(pct(totals, 0.1) / top),
    db(pct(energies, 0.01) / etop),
    db(pct(energies, 0.05) / etop)
  );
}
