/**
 * Compare the src HMM stage (packed int8 model) with the experiment
 * decoder (float model) on round-trip sentences.
 * MODEL=<model.json> node experiments/issue-75-hmm-src-parity.mjs <tier> <lang> [limit]
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';

const [tier = 'telephone', lang = 'zh', limit = '5'] = process.argv.slice(2);
let same = 0;
let total = 0;
let seconds = 0;
let audio = 0;
for (const text of sentences[lang].slice(0, Number(limit))) {
  const spoken = synthesize(text, {
    lang,
    tier,
    head: 'random',
    preset: 'male',
    seed: 1,
  });
  const t0 = performance.now();
  const r = hmmAudioToIpa(spoken.samples, spoken.sampleRate, {
    languages: [lang],
  });
  seconds += (performance.now() - t0) / 1000;
  audio += spoken.duration;
  const words = r.words.map((w) => w.text).join(' ');
  total++;
  console.log(JSON.stringify(text), '→', words, r.modelLanguage);
  same += words.replaceAll(' ', '') === text.replace(/[\p{P}\s]/gu, '');
}
console.log('exact', same, '/', total, 'RTF', (seconds / audio).toFixed(2));
