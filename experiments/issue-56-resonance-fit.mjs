// Issue 56: fit a two-resonance harmonic model to the level of the laugh
// vowel against f0 (experiments/issue-56-level-vs-f0.log).
// node experiments/issue-56-resonance-fit.mjs
import { readFileSync } from 'node:fs';

const rows = readFileSync(
  new globalThis.URL('./issue-56-level-vs-f0.log', import.meta.url),
  'utf8'
)
  .trim()
  .split('\n')
  .map((line) => line.split(' ').map(Number))
  .map(([, f0, level]) => ({ f0, level }));

function resonance(f, F, B) {
  const re = 1 - (f / F) ** 2;
  const im = (f * B) / (F * F);
  return 1 / (re * re + im * im);
}

export function harmonicGain(f0, { f1, f2, b1, b2, slope }) {
  let power = 0;
  for (let k = 1; k * f0 < 4000; k++) {
    const f = k * f0;
    power += (resonance(f, f1, b1) * resonance(f, f2, b2)) / k ** slope;
  }
  return 10 * Math.log10(power);
}

let best = null;
for (const f1 of [650, 660, 670, 680, 690]) {
  for (const b1 of [40, 60, 80, 100, 120, 150, 200]) {
    for (const slope of [2, 3, 4]) {
      const params = { f1, f2: 1510, b1, b2: 100, slope };
      const errors = rows.map(
        (row) => row.level - harmonicGain(row.f0, params)
      );
      const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
      const rms = Math.sqrt(
        errors.reduce((s, e) => s + (e - mean) ** 2, 0) / errors.length
      );
      if (!best || rms < best.rms) {
        best = { rms, params, mean };
      }
    }
  }
}
console.log(best);
for (const row of rows) {
  console.log(
    row.f0,
    row.level,
    (harmonicGain(row.f0, best.params) + best.mean).toFixed(2)
  );
}
