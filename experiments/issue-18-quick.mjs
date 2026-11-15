// Quick checks of the issue 18 metrics against the numbers the issue asks for.
import { performance } from 'node:perf_hooks';
import { createRandom, synthesize } from '../src/index.js';
import {
  compareRecordings,
  dtw,
  editDistance,
  errorRate,
  f0Errors,
  fft,
  logSpectralDistance,
  melCepstralDistortion,
} from '../src/metrics/index.js';

const re = Float64Array.from({ length: 512 }, (_, n) =>
  Math.sin((2 * Math.PI * 8 * n) / 512)
);
const im = new Float64Array(512);
fft(re, im);
let total = 0;
for (let k = 1; k < 256; k++) {
  total += re[k] ** 2 + im[k] ** 2;
}
console.log('fft bin 8 share', (re[8] ** 2 + im[8] ** 2) / total);

const random = createRandom(1);
const x = Float64Array.from({ length: 16000 }, () => random() * 2 - 1);
const half = x.map((v) => v * 0.5);
console.log(
  'lsd gain',
  logSpectralDistance(x, half, 16000, { normalize: false })
);
console.log('lsd normalized', logSpectralDistance(x, half, 16000));
console.log('lsd self', logSpectralDistance(x, x, 16000));
console.log('mcd gain', melCepstralDistortion(x, half, 16000));
const y = new Float64Array(x.length);
for (let n = 0; n < x.length; n++) {
  y[n] = x[n] + 0.9 * (y[n - 1] ?? 0);
}
console.log('mcd filtered', melCepstralDistortion(x, y, 16000));
console.log('dtw', dtw([[0], [1], [2], [3]], [[0], [1], [1], [2], [3]]));
console.log('f0', f0Errors([100, 100, 0, 200], [100, 130, 100, 0]));
console.log('kitten', editDistance([...'kitten'], [...'sitting']));
console.log('wer', errorRate('The cat sat on the mat.', 'the cat sit on mat'));
console.log('cer', errorRate('你好吗', '你好', 'char'));
console.log('per', errorRate('ˈhɛloʊ', 'hɛloʊ', 'phone'));

const a = synthesize('Hello.', { tier: 'minimal', seed: 1 });
const b = synthesize('Hello.', {
  tier: 'minimal',
  seed: 2,
  head: { pitch: 220 },
});
let start = performance.now();
console.log('self', JSON.stringify(compareRecordings(a, a)));
console.log('ms', performance.now() - start);
start = performance.now();
console.log('other', JSON.stringify(compareRecordings(a, b)));
console.log('ms', performance.now() - start);
