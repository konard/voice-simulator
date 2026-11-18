/** Per-term stage B distance of head A with a transcript at stage A and at
 * other speech rates (issue 63). Usage: node rate-terms.mjs [rates...] */
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import {
  accumulate,
  emptyState,
  stateFeatures,
} from '../../src/analysis/voice-fit-statistics.js';
import { totalNuclei } from '../../src/analysis/voice-fit-nuclei.js';
import {
  createMcdMetric,
  featureVector,
} from '../../src/analysis/voice-fit-objective.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';
const text = 'The north wind and the sun.';
const truth = {
  ...DEFAULT_HEAD,
  vocalTractLength: 14,
  pitch: 210,
  tenseness: 0.45,
  speechRate: 1.15,
};
const render = (head) =>
  synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
const audio = render(truth);
const stage = fitVoice(audio.samples, 16000, {
  transcript: text,
  refine: false,
});
const target = featureVector(stage.state);
const mcd = createMcdMetric(audio.samples, 16000);
const names = 'lnf0 range lndF F1 F2 F3 rd h1h2 cpp hnr tilt lnrate'.split(' ');
const show = (label, head) => {
  const r = render(head),
    state = accumulate(emptyState(), r.samples, 16000),
    v = featureVector(state),
    terms = {};
  let mel = 0;
  v.values.forEach((y, i) => {
    const x = target.values[i];
    if (x === null || y === null) {
      return;
    }
    const t = ((y - x) / target.scales[i]) ** 2;
    if (i < 12) {
      terms[names[i]] = +t.toFixed(2);
    } else {
      mel += t;
    }
  });
  const m = mcd(r.samples);
  console.log(
    label,
    'nuclei',
    totalNuclei(state),
    'speech s',
    +state.speechSeconds.toFixed(3),
    'rate',
    +stateFeatures(state).syllableRate.toFixed(3),
    'mel',
    +mel.toFixed(2),
    '4mcd^2',
    +(4 * m * m).toFixed(2),
    JSON.stringify(terms)
  );
};
console.log(
  'target nuclei',
  totalNuclei(stage.state),
  'speech s',
  +stage.state.speechSeconds.toFixed(3)
);
show('truth', truth);
for (const rate of (process.argv.length > 2
  ? process.argv.slice(2)
  : [1.0325, 1.1625]
).map(Number)) {
  show(`stageA rate ${rate}`, { ...stage.head, speechRate: rate });
}
