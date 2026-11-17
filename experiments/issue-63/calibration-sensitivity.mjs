// Unlicense. Check whether the default calibration sentence explains head B.
// All alternatives below were measured by calibrate.mjs on the default head.
import { synthesize } from '../../src/synthesize.js';
import { HEAD_PARAMETERS } from '../../src/head-config.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import {
  accumulate,
  emptyState,
  quantile,
  tableInverse,
} from '../../src/analysis/voice-fit-statistics.js';
import {
  createMcdMetric,
  featureVector,
  vectorDistance,
} from '../../src/analysis/voice-fit-objective.js';
import { PITCH_RANGE_FACTOR } from '../../src/analysis/voice-fit-calibration.js';
const text = 'The north wind and the sun.';
const truth = {
  vocalTractLength: 18.5,
  pitch: 100,
  tenseness: 0.75,
  speechRate: 0.9,
};
const render = (head) =>
  synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
const audio = render(truth),
  stage = fitVoice(audio.samples, 16000, { refine: false });
const target = featureVector(stage.state),
  mcd = createMcdMetric(audio.samples, 16000);
const shortTable = [
  [0, 14.248418807983398],
  [0.25, 15.580679893493652],
  [0.5, 14.123602390289307],
  [0.75, 9.672974109649658],
  [1, 5.829347133636475],
];
const shift = (head, key) => {
  const p = HEAD_PARAMETERS.find((p) => p.key === key);
  const unit = (head[key] - p.min) / (p.max - p.min);
  return {
    ...head,
    [key]: head[key] + (unit < 0.5 ? 0.1 : -0.1) * (p.max - p.min),
  };
};
for (const [name, theta0] of [
  ['baseline', stage.head],
  [
    'shortRange',
    {
      ...stage.head,
      pitchRange:
        (stage.head.pitchRange * (3 / 5.649916483867378)) / PITCH_RANGE_FACTOR,
    },
  ],
  [
    'shortRangeAndHnr',
    {
      ...stage.head,
      pitchRange:
        (stage.head.pitchRange * (3 / 5.649916483867378)) / PITCH_RANGE_FACTOR,
      breathiness: tableInverse(quantile(stage.state, 'hnr'), shortTable),
    },
  ],
]) {
  let best;
  const evaluate = (head, vertex) => {
    const candidate = render(head),
      distortion = mcd(candidate.samples);
    const distance = vectorDistance(
      target,
      featureVector(accumulate(emptyState(), candidate.samples, 16000)),
      true,
      distortion
    );
    const penalty =
      0.05 *
      Object.keys(head).reduce((s, key) => {
        const p = HEAD_PARAMETERS.find((p) => p.key === key);
        return s + ((head[key] - theta0[key]) / (p.max - p.min) / 0.25) ** 2;
      }, 0);
    const row = {
      name,
      vertex,
      distance,
      cost: distance + penalty,
      mcd: distortion,
      pitch: head.pitch,
      length: head.vocalTractLength,
      breathiness: head.breathiness,
    };
    console.log(JSON.stringify(row));
    if (!best || row.cost < best.cost) {
      best = { ...row, head };
    }
  };
  evaluate(theta0, 'initial');
  for (const key of [
    'vocalTractLength',
    'pitch',
    'pitchRange',
    'tenseness',
    'speechRate',
  ]) {
    evaluate(shift(theta0, key), key);
  }
  const base = best.head;
  evaluate(base, 'round2initial');
  for (const key of ['breathiness', 'glottalChink', 'aspirationLevel']) {
    evaluate(shift(base, key), key);
  }
  console.log(JSON.stringify({ name, best }));
}
