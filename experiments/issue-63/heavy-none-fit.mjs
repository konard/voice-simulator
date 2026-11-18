// Unlicense. Issue 63: the no-transcript half of the heavy synthetic gates
// (tests/heavy/copy-voice-fit.test.js) with the same heads and 40 renders.
// Usage: node heavy-none-fit.mjs [seed ...]   (default: seeds 1 to 20)
import {
  fitVoice,
  synthesize,
  createRandom,
  DEFAULT_HEAD,
} from '../../src/index.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const seeds = process.argv.slice(2).map(Number);
const median = (values) => {
  const v = [...values].sort((a, b) => a - b),
    m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const rows = [];
for (const seed of seeds.length
  ? seeds
  : Array.from({ length: 20 }, (_, i) => i + 1)) {
  const random = createRandom(seed),
    range = (a, b) => a + (b - a) * random();
  const truth = {
    ...DEFAULT_HEAD,
    vocalTractLength: range(12, 19),
    pitch: range(90, 260),
    tenseness: range(0.3, 0.9),
    speechRate: range(0.8, 1.25),
    breathiness: range(0.1, 0.9),
  };
  const audio = synthesize(TEXT, {
    head: truth,
    lang: 'en',
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const fit = fitVoice(audio.samples, audio.sampleRate, { maxRenders: 40 });
  const p = fit.parameters.vocalTractLength;
  const row = {
    seed,
    tract:
      (fit.head.vocalTractLength - truth.vocalTractLength) /
      truth.vocalTractLength,
    pitch: (fit.head.pitch - truth.pitch) / truth.pitch,
    rate: (fit.head.speechRate - truth.speechRate) / truth.speechRate,
    tenseness: fit.head.tenseness - truth.tenseness,
    breathiness: fit.head.breathiness - truth.breathiness,
    sd: p.sd,
    covered: Math.abs(p.value - truth.vocalTractLength) <= 3 * p.sd,
  };
  rows.push(row);
  console.log(
    JSON.stringify(row, (k, v) =>
      typeof v === 'number' ? Number(v.toFixed(4)) : v
    )
  );
}
const abs = (key) => median(rows.map((r) => Math.abs(r[key])));
console.log(
  `median |error| tract ${abs('tract').toFixed(4)} pitch ${abs('pitch').toFixed(4)} ` +
    `rate ${abs('rate').toFixed(4)} tenseness ${abs('tenseness').toFixed(4)} ` +
    `breathiness ${abs('breathiness').toFixed(4)}; maximum tract ` +
    `${Math.max(...rows.map((r) => Math.abs(r.tract))).toFixed(4)}; covered ` +
    `${rows.filter((r) => r.covered).length}/${rows.length}`
);
