// Unlicense. Diagnose the prescribed objective without changing its weights.
import { synthesize } from '../../src/synthesize.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import {
  accumulate,
  emptyState,
} from '../../src/analysis/voice-fit-statistics.js';
import {
  createMcdMetric,
  featureVector,
  vectorDistance,
} from '../../src/analysis/voice-fit-objective.js';
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
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
const audio = render(truth);
const stage = fitVoice(audio.samples, 16000, { refine: false });
const target = featureVector(stage.state);
const mcd = createMcdMetric(audio.samples, 16000);
const trace = [];
fitVoice(audio.samples, 16000, {
  transcript: text,
  maxRenders: 10,
  trace: (event) => {
    if (event.stage === 'voice-fit-render') {
      trace.push(event);
    }
  },
});
console.log(JSON.stringify({ truth, parameters: stage.parameters, trace }));
for (const [name, head] of Object.entries({
  truth,
  stageA: stage.head,
  defaultPerturbation: {
    ...stage.head,
    jitter: DEFAULT_HEAD.jitter,
    shimmer: DEFAULT_HEAD.shimmer,
  },
  correctTract: { ...stage.head, vocalTractLength: truth.vocalTractLength },
  correctSource: {
    ...stage.head,
    tenseness: truth.tenseness,
    breathiness: DEFAULT_HEAD.breathiness,
    jitter: DEFAULT_HEAD.jitter,
    shimmer: DEFAULT_HEAD.shimmer,
  },
})) {
  const candidate = render(head);
  const vector = featureVector(
    accumulate(emptyState(), candidate.samples, 16000)
  );
  const distortion = mcd(candidate.samples);
  console.log(
    JSON.stringify({
      name,
      head,
      mcd: distortion,
      distance: vectorDistance(target, vector, true, distortion),
      components: vector.values.map((v, i) =>
        v === null || target.values[i] === null
          ? null
          : ((v - target.values[i]) / target.scales[i]) ** 2
      ),
    })
  );
}
