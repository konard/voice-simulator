// Unlicense. Issue 63: aligned MCD at the stage A values on the default head
// (spec) versus on the nearest preset's unfitted parameters, for the three
// legacy matchVoice preset recordings and one default-geometry head; pitch
// scanned at 0.9, 1 and 1.1 of the stage A value.
import { synthesize, fitVoice, DEFAULT_HEAD } from '../../src/index.js';
import { presetHeadConfig, HEAD_PARAMETERS } from '../../src/head-config.js';
import { createMcdMetric } from '../../src/analysis/voice-fit-objective.js';
import { nearestPreset } from '../../src/analysis/voice-fit.js';
import { resample } from '../../src/audio/resample.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const cases = [
  ['male', presetHeadConfig('male')],
  ['female', presetHeadConfig('female')],
  ['female0.2', presetHeadConfig('female', 0.2)],
  [
    'defaultB',
    {
      ...DEFAULT_HEAD,
      vocalTractLength: 18.5,
      pitch: 100,
      tenseness: 0.75,
      speechRate: 0.9,
    },
  ],
  [
    'defaultA',
    {
      ...DEFAULT_HEAD,
      vocalTractLength: 14,
      pitch: 210,
      tenseness: 0.45,
      speechRate: 1.15,
    },
  ],
];
for (const [name, truth] of cases) {
  const { samples, sampleRate } = synthesize(TEXT, {
    head: truth,
    solver: 'waveguide',
    sampleRate: 22050,
  });
  const mcd = createMcdMetric(
    resample(Array.from(samples), sampleRate, 16000),
    16000
  );
  const fit = fitVoice(samples, sampleRate, {
    refine: false,
    transcript: TEXT,
  });
  const fitted = Object.fromEntries(
    HEAD_PARAMETERS.filter(
      (p) => fit.parameters[p.key].source !== 'default'
    ).map((p) => [p.key, fit.head[p.key]])
  );
  const preset = nearestPreset(fit.head);
  for (const [base, head] of [
    ['default', fit.head],
    [`preset ${preset.name}`, { ...preset.head, ...fitted }],
  ]) {
    const row = [0.9, 1, 1.1].map((f) =>
      mcd(
        synthesize(TEXT, {
          head: { ...head, pitch: head.pitch * f },
          sampleRate: 16000,
          solver: 'waveguide',
        }).samples
      ).toFixed(2)
    );
    console.log(
      name,
      base,
      'pitch',
      head.pitch.toFixed(1),
      'truth',
      truth.pitch,
      'mcd at 0.9/1/1.1',
      row.join(' ')
    );
  }
}
