// Issue 170: cost of the word decoder (hmmAudioToIpa) per phrase length,
// to choose how often the streaming recognizer can afford it.
import { synthesize } from '../../src/index.js';
import { hmmAudioToIpa } from '../../src/recognition/hmm-stage.js';
import { resample } from '../../src/audio/resample.js';

const spoken = synthesize('Hello hello hello hello hello hello hello hello.', {
  lang: 'en',
  tier: 'telephone',
  seed: 1,
});
const x = resample(spoken.samples, spoken.sampleRate, 16000);
hmmAudioToIpa(x.subarray(0, 16000), 16000, { languages: ['en'] }); // warm model
for (const seconds of [0.5, 1, 2, 4]) {
  const n = Math.min(x.length, Math.round(seconds * 16000));
  const t = globalThis.performance.now();
  const d = hmmAudioToIpa(x.subarray(0, n), 16000, { languages: ['en'] });
  console.log(
    `${seconds} s: ${(globalThis.performance.now() - t).toFixed(0)} ms -> ${d.words.map((w) => w.text).join(' ')}`
  );
}
for (const langs of [['en', 'ru', 'hi', 'zh']]) {
  const t = globalThis.performance.now();
  hmmAudioToIpa(x.subarray(0, 32000), 16000, { languages: langs });
  console.log(
    `all langs 2 s first: ${(globalThis.performance.now() - t).toFixed(0)} ms`
  );
  const t2 = globalThis.performance.now();
  hmmAudioToIpa(x.subarray(0, 32000), 16000, { languages: langs });
  console.log(
    `all langs 2 s: ${(globalThis.performance.now() - t2).toFixed(0)} ms`
  );
}
