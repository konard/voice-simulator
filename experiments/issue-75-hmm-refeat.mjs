/**
 * Recompute the pitch statics (4 log2 f0 relative to the median, voicing)
 * and their deltas of rendered training files from the stored 8 kHz audio,
 * after a change of the pitch front end. The cepstra stay as stored: they
 * were computed from the unquantised audio, and the 16-bit copy changes
 * them in near-silent frames.
 * node experiments/issue-75-hmm-refeat.mjs <in.json> <out.json>
 * Unlicense.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pitchStatics } from './issue-75-hmm-lib.mjs';
import { decodeFeats } from './issue-75-hmm-model.mjs';

const CEPS = 13;
const S = CEPS + 2;
const [input, output] = process.argv.slice(2);
const items = JSON.parse(readFileSync(input, 'utf8'));
let changed = 0;
for (const item of items) {
  const b = Buffer.from(item.audio, 'base64');
  const pcm = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
  const x = Float32Array.from(pcm, (v) => v / 32767);
  const feats = decodeFeats(item.feats);
  const n = item.frames;
  if (feats.length !== n * 2 * S) {
    throw new Error(`${input}: ${feats.length / n} values per frame`);
  }
  const { lf0, voicing } = pitchStatics(x, n);
  const pitch = [Float64Array.from(lf0, (v) => 4 * v), voicing];
  const before = feats.slice();
  for (let t = 0; t < n; t++) {
    const at = (u) => Math.min(n - 1, Math.max(0, u));
    for (const [k, v] of pitch.entries()) {
      feats[t * 2 * S + CEPS + k] = v[t];
      feats[t * 2 * S + S + CEPS + k] =
        (2 * (v[at(t + 2)] - v[at(t - 2)]) + (v[at(t + 1)] - v[at(t - 1)])) /
        10;
    }
  }
  changed += Number(feats.some((v, i) => v !== before[i]));
  item.feats = Buffer.from(feats.buffer).toString('base64');
}
writeFileSync(output, JSON.stringify(items));
console.log(input, items.length, 'items,', changed, 'changed');
