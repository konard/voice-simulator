/** Reproduce the public round trip and isolate the audio-to-IPA result. */
import { readFileSync } from 'node:fs';
import { audioToIpa, decodeAudio, synthesize } from '../src/index.js';
import {
  recognize,
  RECOGNITION_LEVELS,
} from '../src/recognition/recognizer.js';

const [file] = process.argv.slice(2);
const recordings = [
  {
    label: 'minimal seed 1',
    ...synthesize('Hello world.', { lang: 'en', tier: 'minimal', seed: 1 }),
  },
];
if (file) {
  recordings.push({ label: file, ...decodeAudio(readFileSync(file)) });
}
for (const { label, samples, sampleRate } of recordings) {
  for (const languages of [undefined, ['en']]) {
    const settings = { languages };
    const time = globalThis.performance.now();
    const result = recognize(samples, sampleRate, settings);
    const elapsed = globalThis.performance.now() - time;
    const decoded = audioToIpa(samples, sampleRate, {
      ...RECOGNITION_LEVELS.medium,
      languages,
      language: languages?.[0],
      nbest: 10,
    });
    console.log(
      JSON.stringify({
        label,
        languages: languages ?? 'auto',
        seconds: elapsed / 1000,
        recognized: result.text,
        acousticIpa: decoded.nbest.map(({ ipa }) => ipa),
      })
    );
  }
}
