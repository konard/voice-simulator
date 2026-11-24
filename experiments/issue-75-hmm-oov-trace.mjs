/**
 * Words of the HMM stage for one sentence, with the phone-loop words shown
 * as [IPA]. node experiments/issue-75-hmm-oov-trace.mjs lang index [tier]
 * [preset]. Environment as issue-75-hmm-eval.mjs. Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang, index, tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const env = process.env;
const search = {};
if (env.OOV_START) {
  search.oovStart = Number(env.OOV_START);
}
if (env.OOV_PHONE) {
  search.oovPhone = Number(env.OOV_PHONE);
}
const text = sentences[lang][Number(index)];
const spoken = synthesize(text, {
  lang,
  tier,
  head: 'random',
  preset,
  seed: 1,
});
console.log(text, spoken.ipa);
const r = hmmAudioToIpa(spoken.samples, spoken.sampleRate, {
  languages: env.BLIND === '0' ? [lang] : ['en', 'ru', 'hi', 'zh'],
  search,
  maxWords: env.WORDS ? Number(env.WORDS) : undefined,
  oov: env.OOV !== '0',
});
console.log(r.language, r.ipa);
console.log(r.words.map((w) => `${w.language}:${w.text}`).join(' '));
console.log(JSON.stringify(r.segments.map((s) => [s.ipa, s.modelWord])));
