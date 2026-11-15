// Probe: time and values of compareRecordings for one golden utterance on
// one tier and for the two anchors (issue 19).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  compareRecordings,
  createRandom,
  decodeFlac,
  presetHeadConfig,
  resample,
  synthesize,
  errorRate,
} from '../src/index.js';

const id = process.argv[2] || 'en-01';
const tier = process.argv[3] || 'minimal';
const manifest = JSON.parse(
  readFileSync('tests/fixtures/golden/manifest.json', 'utf8')
);
const u = manifest.utterances.find((item) => item.id === id);
const reference = decodeFlac(
  new Uint8Array(readFileSync(`tests/fixtures/golden/${u.file}`))
);
let t = performance.now();
const voice = synthesize(u.text, {
  lang: u.lang,
  tier,
  seed: 1,
  head: presetHeadConfig('female'),
});
const render = (performance.now() - t) / 1000;
console.log(
  'render',
  render.toFixed(2),
  's, duration',
  voice.duration.toFixed(2),
  'rtf',
  (render / voice.duration).toFixed(3)
);
console.log(
  'ipa ref ',
  u.ipa,
  '\nipa voice',
  voice.ipa,
  '\nper',
  errorRate(u.ipa, voice.ipa, 'phone').rate
);
const show = (name, m, s) =>
  console.log(
    name,
    `${s.toFixed(2)}s`,
    JSON.stringify({
      lsd: m.lsd,
      mcd: m.mcd,
      f0: m.f0,
      formants: m.formants,
      timing: m.timing,
      duration: m.duration,
    })
  );
t = performance.now();
show(
  'tier',
  compareRecordings(reference, voice),
  (performance.now() - t) / 1000
);
const low = resample(
  resample(reference.samples, reference.sampleRate, 7000),
  7000,
  reference.sampleRate
);
t = performance.now();
show(
  'lowpass',
  compareRecordings(reference, {
    samples: low,
    sampleRate: reference.sampleRate,
  }),
  (performance.now() - t) / 1000
);
let sum = 0;
for (const x of reference.samples) {
  sum += x * x;
}
const rms = Math.sqrt(sum / reference.samples.length);
const random = createRandom(1);
const noise = new Float32Array(reference.samples.length).map(
  () => random() * 2 - 1
);
const scale = rms / Math.sqrt(1 / 3);
for (let i = 0; i < noise.length; i++) {
  noise[i] *= scale;
}
t = performance.now();
show(
  'noise',
  compareRecordings(reference, {
    samples: noise,
    sampleRate: reference.sampleRate,
  }),
  (performance.now() - t) / 1000
);
