// Unlicense. Bounded check of batch-prior dependence at a stretch boundary.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import {
  emptyState,
  addValue,
  quantile,
} from '../../src/analysis/voice-fit-statistics.js';
const heads = [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
];
for (const head of heads) {
  const { samples } = synthesize('The north wind and the sun.', {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  });
  const middle = Math.floor(samples.length / 2);
  const chunks = [
    samples,
    samples.subarray(0, middle),
    samples.subarray(middle),
  ].map((samples) => {
    const frames = analyzeFrames(samples, 16000);
    return { frames, pitch: trackPitch(frames) };
  });
  for (const prior of [null, 16.5]) {
    const states = chunks.map(({ frames, pitch }) => {
      const formants = trackFormants(frames, {
        pitch,
        vocalTractLength: prior,
      });
      const state = emptyState();
      for (let t = 0; t < frames.count; t++) {
        if (
          pitch.f0[t] > 0 &&
          !formants.nasal[t] &&
          [0, 1, 2].every((k) => formants.valid[t * 4 + k])
        ) {
          addValue(
            state,
            'dF',
            [0, 1, 2].reduce(
              (sum, k) => sum + formants.frequency[t * 4 + k] * (k + 0.5),
              0
            ) / 8.75
          );
        }
      }
      return state;
    });
    const split = emptyState();
    split.histograms.dF = states[1].histograms.dF.map(
      (n, i) => n + states[2].histograms.dF[i]
    );
    const wholeLength = 17500 / quantile(states[0], 'dF');
    const splitLength = 17500 / quantile(split, 'dF');
    console.log(
      JSON.stringify({
        head,
        prior,
        wholeLength,
        splitLength,
        disagreement: Math.abs(splitLength / wholeLength - 1),
      })
    );
  }
}
