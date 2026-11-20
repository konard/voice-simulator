/** Reproduce the public round trip and isolate the audio-to-IPA result. */
import { readFileSync } from 'node:fs';
import {
  audioToIpa,
  decodeAudio,
  DEFAULT_HEAD,
  ipaToText,
  resample,
  synthesize,
} from '../src/index.js';
import {
  recognize,
  RECOGNITION_LEVELS,
} from '../src/recognition/recognizer.js';

const args = process.argv.slice(2);
const file = args.find((arg) => arg !== '--variants');
const variants = args.includes('--variants');
const synthesized = synthesize('Hello world.', {
  lang: 'en',
  tier: 'minimal',
  seed: 1,
});
const recordings = [{ label: 'minimal seed 1', ...synthesized }];
console.log(
  JSON.stringify({
    referenceIpa: synthesized.ipa,
    textFromReference: ipaToText(synthesized.ipa, { language: 'en' }).text,
  })
);
if (file) {
  recordings.push({ label: file, ...decodeAudio(readFileSync(file)) });
}
for (const { label, samples, sampleRate } of recordings) {
  for (const languages of [undefined, ['en']]) {
    const settings = { languages };
    const time = globalThis.performance.now();
    const result = recognize(samples, sampleRate, settings);
    const elapsed = globalThis.performance.now() - time;
    const analysisRate = Math.min(sampleRate, RECOGNITION_LEVELS.medium.rate);
    const input =
      sampleRate > analysisRate
        ? resample(samples, sampleRate, analysisRate)
        : samples;
    const decoded = audioToIpa(input, analysisRate, {
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
  if (!variants) {
    continue;
  }
  for (const level of ['low', 'medium', 'high']) {
    for (const extra of [{ rescoring: true }, { voice: DEFAULT_HEAD }]) {
      const result = recognize(samples, sampleRate, {
        ...extra,
        level,
        languages: ['en'],
        nbest: 3,
      });
      console.log(
        JSON.stringify({
          label,
          level,
          rescoring: Boolean(extra.rescoring),
          knownHead: Boolean(extra.voice),
          ipa: result.ipa,
          text: result.text,
          alternativeText: result.alternatives.map(({ text }) => text),
        })
      );
    }
  }
}
