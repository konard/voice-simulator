// Issue 19: MCD and LSD between two real recordings of the golden set and
// between a recording and RMS-matched white noise, to see whether the
// metric separates "another person speaking" from "no speech at all".
//
//   node experiments/issue-19-real-vs-real.mjs [range dB]
import { readFileSync } from 'node:fs';
import { compareRecordings, createRandom, decodeFlac } from '../src/index.js';

const range = Number(process.argv[2] || 60);
const load = (id) =>
  decodeFlac(new Uint8Array(readFileSync(`tests/fixtures/golden/${id}.flac`)));
function noiseLike(ref) {
  const random = createRandom(1);
  const raw = Float64Array.from(ref.samples, () => 2 * random() - 1);
  return { samples: raw, sampleRate: ref.sampleRate };
}
const pairs = [
  ['ru-01', 'ru-02'],
  ['ru-05', 'ru-06'],
  ['hi-01', 'hi-02'],
  ['zh-01', 'zh-02'],
  ['en-03', 'en-04'],
  ['en-01', 'en-02'],
  ['en-01', 'ru-01'],
];
for (const [a, b] of pairs) {
  const ra = load(a);
  const m = compareRecordings(ra, load(b), { range, formants: false });
  const n = compareRecordings(ra, noiseLike(ra), { range, formants: false });
  console.log(
    `${a} vs ${b}: MCD ${m.mcd.toFixed(1)} LSD ${m.lsd.toFixed(1)} | ${a} vs noise: MCD ${n.mcd.toFixed(1)} LSD ${n.lsd.toFixed(1)}`
  );
}
