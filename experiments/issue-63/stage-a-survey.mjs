// Unlicense. Stage A accuracy survey across specified, preset and seeded
// heavy heads (issue 63). Prints truth, stage A and source medians.
import { synthesize, createRandom, DEFAULT_HEAD } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { quantile } from '../../src/analysis/voice-fit-statistics.js';
const SHORT = 'The north wind and the sun.';
const LONG =
  'The north wind and the sun were disputing which was the stronger.';
const cases = [
  [
    'A',
    SHORT,
    16000,
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  ],
  [
    'B',
    SHORT,
    16000,
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ],
  ['female', SHORT, 22050, presetHeadConfig('female')],
  ['male', SHORT, 22050, presetHeadConfig('male')],
  ['female.2', SHORT, 22050, presetHeadConfig('female', 0.2)],
];
const seeds = Number(process.argv[2] ?? 6);
for (let seed = 1; seed <= seeds; seed++) {
  const random = createRandom(seed),
    range = (a, b) => a + (b - a) * random();
  cases.push([
    `seed${seed}`,
    LONG,
    16000,
    {
      vocalTractLength: range(12, 19),
      pitch: range(90, 260),
      tenseness: range(0.3, 0.9),
      speechRate: range(0.8, 1.25),
      breathiness: range(0.1, 0.9),
    },
  ]);
}
const keys = [
  'vocalTractLength',
  'pitch',
  'tenseness',
  'speechRate',
  'breathiness',
];
for (const [name, text, rate, partial] of cases) {
  const truth = { ...DEFAULT_HEAD, ...partial };
  const { samples, sampleRate } = synthesize(text, {
    head: truth,
    seed: 1,
    sampleRate: rate,
    solver: 'waveguide',
    engine: 'js',
  });
  const r = fitVoice(samples, sampleRate, { refine: false });
  const s = r.state;
  const row = { name };
  for (const k of keys) {
    row[k] = `${+truth[k].toFixed(3)}->${+r.head[k].toFixed(3)}`;
  }
  row.hnr = +quantile(s, 'hnr').toFixed(2);
  row.cpp = +quantile(s, 'cpp').toFixed(2);
  row.rd = +quantile(s, 'rd').toFixed(2);
  row.jitter = +r.head.jitter.toFixed(2);
  row.shimmer = +r.head.shimmer.toFixed(2);
  row.syl = +r.features.syllableRate.toFixed(3);
  row.speech = +s.speechSeconds.toFixed(3);
  row.nuclei = s.nuclei;
  console.log(JSON.stringify(row));
}
