// Issue 19: mean absolute difference of the floored log mel energies per
// band (nepers) along the DTW path of compareRecordings, for a pair of real
// recordings and for a recording against white noise. Shows which bands
// dominate the mel-cepstral distortion.
//
//   node experiments/issue-19-band-errors.mjs <id-a> <id-b> [range dB]
import { readFileSync } from 'node:fs';
import { createRandom, decodeFlac } from '../src/index.js';
import {
  dtw,
  hzToMel,
  melToHz,
  powerFrames,
  powerFloor,
  melFilterbank,
} from '../src/metrics/index.js';
import { normalizeRms } from '../src/metrics/distortion.js';
import { trimSilence } from '../src/metrics/compare.js';

const [a, b, rangeArg] = process.argv.slice(2);
if (!a || !b) {
  console.error(
    'Usage: node experiments/issue-19-band-errors.mjs <id-a> <id-b> [range dB]'
  );
  process.exit(1);
}
const range = Number(rangeArg || 60);
const load = (id) =>
  decodeFlac(new Uint8Array(readFileSync(`tests/fixtures/golden/${id}.flac`)));
const ra = load(a);
const random = createRandom(1);
const other =
  b === 'noise'
    ? {
        samples: Float64Array.from(ra.samples, () => 2 * random() - 1),
        sampleRate: 16000,
      }
    : load(b);
const filters = melFilterbank(26, 512, 16000);
function logMel(rec) {
  const x = normalizeRms(trimSilence(rec.samples, 16000), 0.1);
  const energies = powerFrames(x, 16000).map((p) =>
    filters.map((w) => w.reduce((s, v, k) => s + v * p[k], 0))
  );
  const floor = powerFloor(energies, range);
  return energies.map((e) => e.map((v) => Math.log(Math.max(v, floor))));
}
const LR = logMel(ra);
const LT = logMel(other);
const centred = (L) =>
  L.map((row) => {
    const m = row.reduce((s, v) => s + v, 0) / row.length;
    return row.map((v) => v - m);
  });
const { path } = dtw(centred(LR), centred(LT));
const top = hzToMel(8000);
const sums = new Array(26).fill(0);
const floorR = new Array(26).fill(0);
const floorT = new Array(26).fill(0);
const minR = Math.min(...LR.flat());
const minT = Math.min(...LT.flat());
for (const [i, j] of path) {
  for (let m = 0; m < 26; m++) {
    sums[m] += Math.abs(LR[i][m] - LT[j][m]);
    if (LR[i][m] === minR) {
      floorR[m]++;
    }
    if (LT[j][m] === minT) {
      floorT[m]++;
    }
  }
}
console.log(
  `${a} vs ${b}, range ${range} dB: band, centre Hz, mean |dL| nepers, share of pairs at the floor (ref, test)`
);
for (let m = 0; m < 26; m++) {
  console.log(
    String(m + 1).padStart(2),
    melToHz((top * (m + 1)) / 27)
      .toFixed(0)
      .padStart(5),
    (sums[m] / path.length).toFixed(2).padStart(6),
    (floorR[m] / path.length).toFixed(2),
    (floorT[m] / path.length).toFixed(2)
  );
}
