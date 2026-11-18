// Unlicense. Issue 63: signed errors (fit / truth - 1) on the heavy suite's
// seeded heads. Usage: node heavy-seeds.mjs transcript|none renders [seeds]
import {
  fitVoice,
  synthesize,
  createRandom,
  DEFAULT_HEAD,
} from '../../src/index.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const [mode = 'transcript', renders = '0', list] = process.argv.slice(2);
const seeds = list
  ? list.split(',').map(Number)
  : Array.from({ length: 20 }, (_, i) => i + 1);
const keys = [
  'vocalTractLength',
  'pitch',
  'speechRate',
  'tenseness',
  'breathiness',
];
const rows = [];
for (const seed of seeds) {
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
  const { samples, sampleRate } = synthesize(TEXT, {
    head: truth,
    lang: 'en',
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const result = fitVoice(samples, sampleRate, {
    transcript: mode === 'transcript' ? TEXT : undefined,
    refine: +renders > 0,
    maxRenders: Math.max(1, +renders),
  });
  const row = { seed };
  for (const k of keys) {
    row[k] =
      k === 'tenseness' || k === 'breathiness'
        ? +(result.head[k] - truth[k]).toFixed(3)
        : +(result.head[k] / truth[k] - 1).toFixed(4);
  }
  row.truth = {
    tract: +truth.vocalTractLength.toFixed(2),
    pitch: +truth.pitch.toFixed(1),
    rate: +truth.speechRate.toFixed(3),
  };
  row.sd = +result.parameters.vocalTractLength.sd.toFixed(3);
  rows.push(row);
  console.log(JSON.stringify(row));
}
const median = (a) => {
  const s = a.map(Math.abs).sort((x, y) => x - y),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
console.log(
  'median |error|',
  JSON.stringify(
    Object.fromEntries(
      keys.map((k) => [k, +median(rows.map((r) => r[k])).toFixed(4)])
    )
  )
);
const smedian = (a) => {
  const s = [...a].sort((x, y) => x - y),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
console.log(
  'median signed',
  JSON.stringify(
    Object.fromEntries(
      keys.map((k) => [k, +smedian(rows.map((r) => r[k])).toFixed(4)])
    )
  )
);
