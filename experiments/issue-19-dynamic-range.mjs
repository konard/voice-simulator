// Issue 19: how the dynamic range of the log floor in src/metrics/ changes
// MCD and LSD of a tier and of the two anchors (lowpass at 7000 Hz and
// RMS-matched white noise). Before the fix the floor was an absolute
// 1e-10, about 100 dB below a normalised frame (range "abs" below).
//
//   node experiments/issue-19-dynamic-range.mjs [tier] [ids...]
import { readFileSync } from 'node:fs';
import {
  compareRecordings,
  createRandom,
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';

const tier = process.argv[2] || 'minimal';
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const ids = process.argv.slice(3);
const items = manifest.utterances.filter((u) =>
  ids.length ? ids.includes(u.id) : /-0[12]$/.test(u.id)
);
const ranges = [40, 50, 60, 70, 80, 300];
console.log(
  `tier ${tier}; columns: range dB, then MCD and LSD of tier | lowpass | noise`
);
for (const u of items) {
  const reference = decodeFlac(
    new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
  );
  const voice = synthesize(u.text, {
    lang: u.lang,
    tier,
    seed: 1,
    head: presetHeadConfig(u.speaker.sex === 'male' ? 'male' : 'female'),
  });
  const low = {
    samples: resample(
      resample(reference.samples, reference.sampleRate, 7000),
      7000,
      reference.sampleRate
    ),
    sampleRate: reference.sampleRate,
  };
  let sum = 0;
  for (const x of reference.samples) {
    sum += x * x;
  }
  const rms = Math.sqrt(sum / reference.samples.length);
  const random = createRandom(1);
  const raw = Float64Array.from(reference.samples, () => 2 * random() - 1);
  let s2 = 0;
  for (const x of raw) {
    s2 += x * x;
  }
  const gain = rms / Math.sqrt(s2 / raw.length);
  const noise = {
    samples: raw.map((x) => x * gain),
    sampleRate: reference.sampleRate,
  };
  for (const range of ranges) {
    const opts = { range, formants: false };
    const [a, b, c] = [voice, low, noise].map((t) =>
      compareRecordings(reference, t, opts)
    );
    const f = (x) => x.toFixed(1).padStart(6);
    console.log(
      `${u.id} ${String(range === 300 ? 'abs' : range).padStart(3)}  MCD ${f(a.mcd)} ${f(b.mcd)} ${f(c.mcd)}   LSD ${f(a.lsd)} ${f(b.lsd)} ${f(c.lsd)}  ${a.mcd < c.mcd && b.mcd < c.mcd ? 'ok' : 'BAD'}`
    );
  }
}
