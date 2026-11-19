// How close can a steady rendered template get to each recorded frame?
// Prints the mean per-frame MCD of the best template (no smoothness) and the
// mean MCD of the reference against its own mean cepstrum.
import { items } from './issue-150-cache.mjs';
import { readFileSync } from 'node:fs';
import { cepstra, powerFrames } from '../src/metrics/spectrum.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
const C = 13,
  S = 10 / Math.LN10;
const ids = process.argv.slice(2);
const sums = [0, 0, 0];
const chosen = ids.length ? items.filter((x) => ids.includes(x.id)) : items;
for (const item of chosen) {
  const bytes = readFileSync(
    `/tmp/issue150-cache/${item.speaker.id}.templates.bin`
  );
  const tp = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4
  );
  const rows = tp.length / C;
  const frames = powerFrames(normalizeRms(item.samples), item.sampleRate);
  const cr = cepstra(frames, item.sampleRate);
  const silent = silentFrames(frames);
  const idx = cr.map((_, i) => i).filter((i) => !silent[i]);
  const mean = Array.from(
    { length: C },
    (_, k) => idx.reduce((s, i) => s + cr[i][k + 1], 0) / idx.length
  );
  let best = 0,
    own = 0;
  for (const i of idx) {
    let m = Infinity;
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = 0; k < C; k++) {
        const d = cr[i][k + 1] - tp[r * C + k];
        s += d * d;
      }
      if (s < m) {
        m = s;
      }
    }
    best += S * Math.sqrt(2 * m);
    let s = 0;
    for (let k = 0; k < C; k++) {
      s += (cr[i][k + 1] - mean[k]) ** 2;
    }
    own += S * Math.sqrt(2 * s);
  }
  best /= idx.length;
  own /= idx.length;
  sums[0] += best;
  sums[1] += own;
  console.log(
    item.id,
    'best-template',
    best.toFixed(2),
    'own-mean',
    own.toFixed(2)
  );
}
console.log(
  'mean best-template',
  (sums[0] / chosen.length).toFixed(3),
  'own-mean',
  (sums[1] / chosen.length).toFixed(3)
);
