// Issue 170: where the streaming recognizer commits a long phrase, with the
// word decoder reading each committed phrase.
import { createRecognizer, synthesize } from '../../src/index.js';

const sampleRate = 8000;
const { samples } = synthesize(
  'A little bird sings while a swift swallow flies and a clever raven calls through the night',
  { lang: 'en', tier: 'telephone', seed: 1 }
);
const rec = createRecognizer({
  sampleRate,
  languages: ['en'],
  level: 'low',
  modes: false,
  minVoiced: Number(process.env.MIN_VOICED ?? 0.1),
});
let pushed = 0;
rec.on('final', (e) =>
  console.log(
    `final at ${pushed.toFixed(2)} s: ${e.text} [${e.words.map((w) => `${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(' ')}]`
  )
);
rec.on('error', (e) => console.log('error', e));
for (let i = 0; i < samples.length; i += 160) {
  pushed = Math.min(samples.length, i + 160) / sampleRate;
  rec.push(samples.subarray(i, i + 160));
}
console.log('flush', rec.flush().text);
