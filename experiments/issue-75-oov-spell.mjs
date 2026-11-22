/** Spell OOV corpus words from their IPA and read them back. Unlicense. */
import { textToIpa } from '../src/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { spellSounds } from '../src/recognition/phones-to-letters.js';

const words = {
  ru: 'съешь булок щука ближайшая аптека цыплёнок цирке купили яблоки хитрый юный рисует болел птицу молчишь',
  hi: 'झंडा व्यस्त बोलिए सब्ज़ी रुको',
  en: 'jumps choosing',
};
for (const [lang, list] of Object.entries(words)) {
  let same = 0;
  const all = list.split(' ');
  for (const w of all) {
    const ipa = textToIpa(w, { lang }).words[0].ipa;
    const spelled = spellSounds(parseIpa(ipa).tokens ?? parseIpa(ipa), lang);
    const text =
      typeof spelled === 'string' ? spelled : JSON.stringify(spelled);
    const back = textToIpa(text, { lang })
      .words.map((x) => x.ipa)
      .join(' ');
    same += back === ipa;
    console.log(lang, w, ipa, '→', text, '→', back, back === ipa ? 'OK' : '');
  }
  console.log(lang, same, '/', all.length);
}
