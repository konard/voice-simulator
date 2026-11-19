// Values behind the constantCepstrumDistortion unit test (issue 150).
import {
  constantCepstrumDistortion as c,
  melCepstralDistortion as m,
  createRandom,
} from '../src/index.js';
const r = createRandom(1);
const x = Float64Array.from({ length: 16000 }, () => r() * 2 - 1);
const y = new Float64Array(x.length);
for (let n = 0; n < x.length; n++) {
  y[n] = x[n] + 0.9 * (n > 0 ? y[n - 1] : 0);
}
const mid = x.length >> 1;
const joined = Float64Array.from(x, (v, n) => (n < mid ? v : 0.1 * y[n]));
const firstOnly = Float64Array.from(x, (_, n) => x[n % mid]);
console.log(
  'noise',
  c(x, 16000),
  'joined',
  c(joined, 16000),
  'mcd first-only',
  m(joined, firstOnly, 16000),
  'mcd self-noise',
  m(
    x,
    x.map((_, n) => x[(n + 4000) % x.length]),
    16000
  )
);
