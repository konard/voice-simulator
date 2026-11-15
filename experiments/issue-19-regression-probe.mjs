// Values behind the issue 19 regression tests in tests/metrics.test.js:
// the pair rule (silent reference frames are skipped) and the 60 dB floor.
// Usage: node experiments/issue-19-regression-probe.mjs
import {
  createRandom,
  logSpectralDistance,
  melCepstralDistortion,
  resample,
} from '../src/index.js';

const random = createRandom(1);
const white = (n, level = 1) =>
  Float64Array.from({ length: n }, () => level * (random() * 2 - 1));
const coloured = (x) => {
  const y = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    y[n] = x[n] + 0.9 * (n > 0 ? y[n - 1] : 0);
  }
  return y;
};
const burst = coloured(white(8000));
const reference = new Float64Array(16000);
reference.set(burst);
reference.set(white(8000, 1e-4), 8000);
const test = white(16000);
console.log(
  'mcd burst only',
  melCepstralDistortion(burst, test.slice(0, 8000), 16000)
);
console.log('mcd with pause', melCepstralDistortion(reference, test, 16000));
const x = white(16000);
const low = resample(resample(x, 16000, 7000), 7000, 16000);
for (const range of [60, 200]) {
  console.log(
    'range',
    range,
    'lsd',
    logSpectralDistance(x, low, 16000, { range }),
    'mcd',
    melCepstralDistortion(x, low, 16000, { range })
  );
}
