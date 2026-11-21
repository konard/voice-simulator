/** Probe the recognizer input to the synthetic copy quality gate. Unlicense. */
import {
  errorRate,
  presetHeadConfig,
  recognize,
  synthesize,
} from '../src/index.js';

const voice = presetHeadConfig('female');
const { samples, sampleRate, ipa } = synthesize('Hello world.', {
  tier: 'minimal',
  sampleRate: 16000,
  seed: 1,
  engine: 'js',
  head: voice,
});
const recognized = recognize(samples, sampleRate, {
  voice,
  languages: ['en'],
  deterministic: true,
  segments: true,
});

console.log(
  JSON.stringify(
    {
      source: ipa,
      text: recognized.text,
      recognized: recognized.ipa,
      phonemes: errorRate(ipa, recognized.ipa, 'phone'),
      segments: recognized.segments,
    },
    null,
    2
  )
);
