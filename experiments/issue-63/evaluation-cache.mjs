// Unlicense. Count repeated exact heads without retaining generated audio.
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { HEAD_PARAMETERS } from '../../src/head-config.js';
const text = 'The north wind and the sun.';
const audio = synthesize(text, {
  head: {
    vocalTractLength: 18.5,
    pitch: 100,
    tenseness: 0.75,
    speechRate: 0.9,
  },
  sampleRate: 16000,
  solver: 'waveguide',
  engine: 'js',
  seed: 1,
});
const seen = new Map(),
  repeats = [];
const result = fitVoice(audio.samples, audio.sampleRate, {
  transcript: text,
  maxRenders: 40,
  onStep: ({ renders, head }) => {
    const key = JSON.stringify(HEAD_PARAMETERS.map(({ key }) => head[key]));
    if (seen.has(key)) {
      repeats.push([seen.get(key), renders]);
    } else {
      seen.set(key, renders);
    }
  },
});
console.log(
  JSON.stringify({
    renders: result.renders,
    distinct: seen.size,
    repeats,
    head: result.head,
    distance: result.distance,
  })
);
