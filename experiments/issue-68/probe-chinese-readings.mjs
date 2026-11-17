/** Finite check of the complete pinyin inverse on 200 held-out words. */
import { characterReadings } from '../../src/g2p/chinese-readings.js';
import { pinyinSyllableToIpa, syllableWithTone } from '../../src/g2p/pinyin.js';
import { textToIpa } from '../../src/g2p/index.js';
import { parseIpa } from '../../src/ipa/parse.js';
import { syllabifyTokens } from '../../src/ipa/syllables.js';
import { phoneDistance } from '../../src/recognition/phone-distance.js';
import { getCounts } from '../../src/recognition/data/index.js';
import { ipaKey } from '../../tests/helpers/ipa-recognition.js';

const counts = getCounts('zh');
const inverse = new Map();
for (const [char, readings] of characterReadings()) {
  for (const reading of readings) {
    const syllable = pinyinSyllableToIpa(reading);
    if (!syllable) {
      continue;
    }
    const ipa = syllableWithTone(syllable, true);
    const count = counts.counts.get(char) ?? 0;
    if (!inverse.has(ipa) || count > inverse.get(ipa).count) {
      inverse.set(ipa, { char, count, tokens: parseIpa(ipa).tokens });
    }
  }
}
let recovered = 0;
const failures = [];
for (const { word } of counts.words.slice(0, 200)) {
  const ipa = textToIpa(word, { lang: 'zh' }).ipa;
  const output = syllabifyTokens(
    parseIpa(ipa).tokens.filter((token) => token.kind !== 'pause'),
    { language: 'zh' }
  )
    .map((syllable) => {
      let best;
      let cost = Infinity;
      for (const item of inverse.values()) {
        if (item.tokens.length !== syllable.length) {
          continue;
        }
        const next = syllable.reduce(
          (sum, token, i) =>
            sum +
            phoneDistance(token, item.tokens[i]) +
            (token.symbol === item.tokens[i].symbol ? 0 : 0.001),
          0
        );
        if (next < cost || (next === cost && item.count > best.count)) {
          best = item;
          cost = next;
        }
      }
      return best?.char ?? '';
    })
    .join('');
  const same = ipaKey(ipa) === ipaKey(textToIpa(output, { lang: 'zh' }).ipa);
  recovered += Number(same);
  if (!same) {
    failures.push({ word, output });
  }
}
console.log(JSON.stringify({ recovered, total: 200, failures }, null, 2));
