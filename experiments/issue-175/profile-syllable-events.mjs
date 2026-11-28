/** Find short telephone audio whose syllable event carries fixed phonemes. */
import { createRecognizer, synthesize } from '../../src/index.js';

const sampleRate = 8000;
for (const text of [
  'A little bird sings.',
  'Hello world.',
  'The quick brown fox jumps over the lazy dog.',
]) {
  const { samples } = synthesize(text, {
    lang: 'en',
    tier: 'telephone',
    seed: 1,
  });
  let found = false;
  for (let end = 1600; end <= samples.length; end += 160) {
    const stream = createRecognizer({
      sampleRate,
      languages: ['en'],
      level: 'low',
      modes: false,
      decoder: 'phones',
    });
    const events = [];
    stream.on('syllable', (event) => events.push(event));
    stream.push(samples.subarray(0, end));
    stream.flush();
    const event = events.find(({ ipa }) => ipa);
    if (event) {
      console.log({ text, end, event });
      found = true;
      break;
    }
  }
  if (found) {
    break;
  }
}
