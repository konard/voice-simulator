/**
 * Oracle for out-of-vocabulary words: does the phonetic spelling that
 * ipaToText (or the rule speller, RULES=1) gives for a word's IPA read back
 * (textToIpa) as the same IPA?
 * node experiments/issue-75-oov-spelling.mjs [maxWords]. Unlicense.
 */
import { ipaToText, textToIpa, tokenize } from '../src/index.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { spellSounds } from '../src/recognition/phones-to-letters.js';
import { parseIpa } from '../src/ipa/parse.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const maxWords = Number(process.argv[2] ?? 20000);
for (const lang of ['en', 'ru', 'hi']) {
  const lexicon = getLexicon(lang);
  const rank = new Map(lexicon.words.map(({ word }, i) => [word, i]));
  let same = 0;
  let total = 0;
  for (const text of sentences[lang]) {
    for (const word of tokenize(text, 'word')) {
      const key = word.toLowerCase();
      const r = rank.get(key);
      if (!/^[\p{L}\p{M}]+$/u.test(key) || (r !== undefined && r < maxWords)) {
        continue;
      }
      total++;
      const ipa = textToIpa(key, { lang })
        .words.map((w) => w.ipa)
        .join(' ');
      const spelled = process.env.RULES
        ? spellSounds(parseIpa(ipa).tokens, lang)
        : ipaToText(ipa, { language: lang, boundaries: 'given' }).text;
      const back = textToIpa(spelled, { lang })
        .words.map((w) => w.ipa)
        .join(' ');
      same += Number(back === ipa);
      console.log(
        lang,
        key,
        ipa,
        '→',
        spelled,
        '→',
        back,
        back === ipa ? 'ok' : 'DIFF'
      );
    }
  }
  console.log(`${lang}: ${same}/${total} read back the same`);
}
