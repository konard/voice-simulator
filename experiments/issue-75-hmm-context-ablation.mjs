/**
 * Decode sentences with subsets of the context-dependent states removed,
 * to see which contexts help. node experiments/issue-75-hmm-context-ablation.mjs
 * [tier] [preset] [cases] — modes: all, none, no vowel entries, no entries,
 * no exits. Unlicense.
 */
import { synthesize } from '../src/index.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { buildNetwork } from '../src/recognition/hmm-network.js';
import { decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'telephone', preset = 'male', casesArg = 'en:17,ru:1,zh:1'] =
  process.argv.slice(2);
const base = getHmmModel();
const isVowel = (unit) => [...unit].some((ch) => VOWELS[ch]);
const modes = {
  all: () => true,
  none: () => false,
  noVowelEntry: (key) => !(key.includes('#0<') && isVowel(key.split('#')[0])),
  noEntry: (key) => !key.includes('#0<'),
  noExit: (key) => !key.includes('#2>'),
};
const only = process.env.MODES?.split(',') ?? Object.keys(modes);
const cases = casesArg.split(',').map((c) => c.split(':'));
const rendered = cases.map(([lang, index]) => {
  const text = sentences[lang][Number(index)];
  const spoken = synthesize(text, {
    lang,
    tier,
    head: 'random',
    preset,
    seed: 1,
  });
  return {
    lang,
    text,
    ...hmmFeatures(spoken.samples, spoken.sampleRate, base.lda),
  };
});
for (const mode of only) {
  const keep = modes[mode];
  const model = {
    ...base,
    contextIndex: new Map([...base.contextIndex].filter(([key]) => keep(key))),
  };
  const byLang = new Map();
  for (const { lang, text, feats, frames } of rendered) {
    if (!byLang.has(lang)) {
      byLang.set(lang, buildNetwork(model, [lang]));
    }
    const d = decodeWords(byLang.get(lang), feats, frames);
    console.log(
      mode,
      lang,
      '|',
      text,
      '|',
      d.words.map((w) => w.word).join(' ')
    );
  }
}
