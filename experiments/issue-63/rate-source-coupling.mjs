// Unlicense. Eight finite evaluations isolate source and rate compensation.
import { synthesize } from '../../src/synthesize.js';
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
const render = (head) =>
  synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
const audio = render({
  vocalTractLength: 18.5,
  pitch: 100,
  tenseness: 0.75,
  speechRate: 0.9,
});
const initial = fitVoice(audio.samples, 16000, { refine: false });
const target = featureVector(initial.state),
  mcd = createMcdMetric(audio.samples, 16000);
console.log(
  JSON.stringify({
    initial: Object.fromEntries(
      [
        'vocalTractLength',
        'pitch',
        'tenseness',
        'breathiness',
        'speechRate',
        'jitter',
        'shimmer',
      ].map((key) => [key, initial.head[key]])
    ),
  })
);
for (const breathiness of [0.2, 0.25, 0.3, 0.35]) {
  for (const rateStep of [0, 0.13]) {
    const head = {
      ...initial.head,
      breathiness,
      speechRate: initial.head.speechRate + rateStep,
    };
    const candidate = render(head);
    const state = accumulate(emptyState(), candidate.samples, 16000, {}, false);
    const distortion = mcd(candidate.samples);
    console.log(
      JSON.stringify({
        breathiness,
        rate: head.speechRate,
        mcd: distortion,
        distance: vectorDistance(
          target,
          featureVector(state),
          true,
          distortion
        ),
      })
    );
  }
}
