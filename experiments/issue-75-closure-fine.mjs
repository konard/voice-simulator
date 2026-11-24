/**
 * Fine (2 ms) level and zero-crossing rate of the synthesised audio around
 * one phone of a round-trip sentence, to see what fills a stop closure.
 * node experiments/issue-75-closure-fine.mjs <lang> <index|text> <phone> [nth]
 * Environment: TIER (telephone), PRESET (male).
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang, index, phone, nth = '0'] = process.argv.slice(2);
const text = /^\d+$/u.test(index) ? sentences[lang][Number(index)] : index;
const spoken = synthesize(text, {
  lang,
  tier: process.env.TIER ?? 'telephone',
  preset: process.env.PRESET ?? 'male',
  head: 'random',
  seed: 1,
});
const { samples, sampleRate } = spoken;
const segments = spoken.plan.segments ?? spoken.plan;
const sym = (s) => s.token?.symbol ?? s.kind;
const hits = segments.filter((s) => sym(s) === phone);
const seg = hits[Number(nth)];
if (!seg) {
  console.log(
    'phones:',
    segments.map(sym).join(' '),
    Object.keys(segments[0] ?? {})
  );
  process.exit(1);
}
let peak = 0;
for (const v of samples) {
  peak = Math.max(peak, Math.abs(v));
}
const step = Math.round(sampleRate * 0.002);
const from = Math.max(0, Math.round((seg.start - 0.04) * sampleRate));
const to = Math.min(samples.length, Math.round((seg.end + 0.06) * sampleRate));
console.log(
  `${phone} ${seg.start.toFixed(3)}-${seg.end.toFixed(3)} s`,
  JSON.stringify(seg.target)
);
for (let i = from; i + step <= to; i += step) {
  let e = 0;
  let z = 0;
  for (let j = i; j < i + step; j++) {
    e += samples[j] ** 2;
    z += Number(j > i && Math.sign(samples[j]) !== Math.sign(samples[j - 1]));
  }
  const t = i / sampleRate;
  const db = 10 * Math.log10(e / step / peak ** 2 + 1e-12);
  const inside = t >= seg.start && t < seg.end ? '*' : ' ';
  console.log(
    `${t.toFixed(3)}${inside} ${db.toFixed(1).padStart(6)} dB zcr ${(z / step).toFixed(2)} ${'#'.repeat(Math.max(0, Math.round((db + 60) / 2)))}`
  );
}
