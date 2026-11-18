// Unlicense. Issue 63: stage A value, sd and error of the round-1 parameters
// for the legacy preset recordings and the unit-test heads.
import { synthesize, fitVoice, DEFAULT_HEAD } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
const NORTH =
  'The north wind and the sun were disputing which was the stronger.';
const SHORT = 'The north wind and the sun.';
const cases = [
  ['male', presetHeadConfig('male'), NORTH, 22050],
  ['female', presetHeadConfig('female'), NORTH, 22050],
  ['female0.2', presetHeadConfig('female', 0.2), NORTH, 22050],
  [
    'A',
    {
      ...DEFAULT_HEAD,
      vocalTractLength: 14,
      pitch: 210,
      tenseness: 0.45,
      speechRate: 1.15,
    },
    SHORT,
    16000,
  ],
  [
    'B',
    {
      ...DEFAULT_HEAD,
      vocalTractLength: 18.5,
      pitch: 100,
      tenseness: 0.75,
      speechRate: 0.9,
    },
    SHORT,
    16000,
  ],
];
const KEYS = [
  'vocalTractLength',
  'pitch',
  'pitchRange',
  'tenseness',
  'speechRate',
  'breathiness',
];
for (const [name, truth, text, rate] of cases) {
  const { samples, sampleRate } = synthesize(text, {
    head: truth,
    solver: 'waveguide',
    sampleRate: rate,
    seed: 1,
    engine: 'js',
  });
  const fit = fitVoice(samples, sampleRate, {
    refine: false,
    transcript: text,
  });
  console.log(
    name,
    KEYS.map(
      (k) =>
        `${k} ${fit.head[k].toFixed(3)}±${fit.parameters[k].sd.toFixed(3)} (${truth[k]}, ${((fit.head[k] - truth[k]) / fit.parameters[k].sd).toFixed(1)} sd)`
    ).join(' | ')
  );
}
