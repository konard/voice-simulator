// Stage A transcript readings of the male preset saying the north-wind text.
import { fitVoice, synthesize } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
for (const name of ['male', 'female']) {
  const head = presetHeadConfig(name);
  const audio = synthesize(TEXT, {
    head,
    solver: 'waveguide',
    sampleRate: 22050,
    seed: 1,
    engine: 'js',
  });
  const fit = fitVoice(audio.samples, audio.sampleRate, {
    refine: false,
    transcript: TEXT,
  });
  console.log(
    name,
    'pitch',
    head.pitch,
    '->',
    fit.head.pitch.toFixed(2),
    'rate',
    head.speechRate,
    '->',
    fit.head.speechRate.toFixed(3),
    'range',
    head.pitchRange,
    '->',
    fit.head.pitchRange.toFixed(2)
  );
}
