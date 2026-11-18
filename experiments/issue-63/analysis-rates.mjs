// Unlicense. Bounded working-rate comparison on the two required heads.
import { performance } from 'node:perf_hooks';
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
const text = 'The north wind and the sun.';
for (const head of [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
]) {
  const audio = synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  for (const analysisRate of [8000, 11025, 16000]) {
    const start = performance.now();
    const fit = fitVoice(audio.samples, 16000, { refine: false, analysisRate });
    console.log(
      JSON.stringify({
        truth: head,
        analysisRate,
        milliseconds: performance.now() - start,
        parameters: Object.fromEntries(
          [
            'vocalTractLength',
            'pitch',
            'pitchRange',
            'tenseness',
            'breathiness',
            'speechRate',
          ].map((k) => [k, fit.parameters[k]])
        ),
      })
    );
  }
}
