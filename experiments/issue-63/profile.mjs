// Unlicense. A single bounded fit for node --cpu-prof.
import { performance } from 'node:perf_hooks';
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { presetHeadConfig } from '../../src/head-config.js';
const text =
  'The north wind and the sun were disputing which was the stronger.';
const truth = presetHeadConfig('female');
const audio = synthesize(text, {
  head: truth,
  solver: 'waveguide',
  sampleRate: 22050,
  engine: 'js',
  seed: 1,
});
const start = performance.now();
const fit = fitVoice(audio.samples, 22050, {
  transcript: text,
  maxRenders: 40,
});
console.log(
  JSON.stringify({
    seconds: (performance.now() - start) / 1000,
    truth,
    head: fit.head,
    renders: fit.renders,
    distance: fit.distance,
  })
);
