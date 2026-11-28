/** Rule spelling for sounds absent from the reverse vocabulary. */
import { formatIpa, parseIpa } from '../ipa/parse.js';
import { syllabifyTokens } from '../ipa/syllables.js';
import { characterReadings } from '../g2p/chinese-readings.js';
import { pinyinSyllableToIpa, syllableWithTone } from '../g2p/pinyin.js';
import { checkLanguage } from './languages.js';
import { getCounts } from './data/index.js';
import { phoneDistance } from './phone-distance.js';

export const ENGLISH_SOUND_SPELLINGS = Object.freeze({
  i: 'ee',
  ɪ: 'i',
  e: 'ay',
  eɪ: 'ay',
  ɛ: 'e',
  æ: 'a',
  aɪ: 'igh',
  aʊ: 'ou',
  oʊ: 'oa',
  ɔɪ: 'oy',
  ɑ: 'o',
  ɒ: 'o',
  ɔ: 'aw',
  ʊ: 'oo',
  u: 'oo',
  ʌ: 'u',
  ə: 'a',
  ɚ: 'er',
  ɝ: 'er',
  ɜ: 'er',
  p: 'p',
  b: 'b',
  t: 't',
  d: 'd',
  k: 'k',
  ɡ: 'g',
  f: 'f',
  v: 'v',
  θ: 'th',
  ð: 'th',
  s: 's',
  z: 'z',
  ʃ: 'sh',
  ʒ: 'zh',
  t͡ʃ: 'ch',
  d͡ʒ: 'j',
  m: 'm',
  n: 'n',
  ŋ: 'ng',
  l: 'l',
  ɾ: 'd',
  ɹ: 'r',
  r: 'r',
  j: 'y',
  w: 'w',
  h: 'h',
  ʔ: '',
});

const RU_CONSONANTS = {
  p: 'п',
  b: 'б',
  t: 'т',
  d: 'д',
  k: 'к',
  ɡ: 'г',
  f: 'ф',
  v: 'в',
  s: 'с',
  z: 'з',
  ʂ: 'ш',
  ʐ: 'ж',
  ɕ: 'щ',
  t͡ɕ: 'ч',
  t͡s: 'ц',
  m: 'м',
  n: 'н',
  r: 'р',
  l: 'л',
  ɫ: 'л',
  x: 'х',
  j: 'й',
};
const RU_VOWELS = {
  a: 'а',
  ɑ: 'а',
  ɐ: 'а',
  ə: 'а',
  o: 'о',
  u: 'у',
  ʊ: 'у',
  e: 'э',
  ɛ: 'э',
  ɪ: 'и',
  i: 'и',
  ɨ: 'ы',
};
const RU_SOFT = { а: 'я', о: 'ё', у: 'ю', э: 'е', и: 'и', ы: 'и' };

function russian(tokens) {
  return tokens
    .map((t, i) => {
      if (t.kind === 'vowel') {
        const letter = RU_VOWELS[t.base] ?? 'а';
        const vowel = tokens[i - 1]?.palatalized ? RU_SOFT[letter] : letter;
        return vowel + (t.stress ? '́' : '');
      }
      const symbol = t.affricate
        ? `${t.affricate.stop}͡${t.affricate.fricative}`
        : t.base;
      const letter = RU_CONSONANTS[symbol] ?? '';
      return (
        letter + (t.palatalized && tokens[i + 1]?.kind !== 'vowel' ? 'ь' : '')
      );
    })
    .join('');
}

const HI_CONSONANTS = {
  k: 'क',
  kʰ: 'ख',
  ɡ: 'ग',
  ɡʱ: 'घ',
  ŋ: 'ङ',
  t͡ʃ: 'च',
  t͡ʃʰ: 'छ',
  d͡ʒ: 'ज',
  d͡ʒʱ: 'झ',
  ɲ: 'ञ',
  ʈ: 'ट',
  ʈʰ: 'ठ',
  ɖ: 'ड',
  ɖʱ: 'ढ',
  ɳ: 'ण',
  t̪: 'त',
  t̪ʰ: 'थ',
  d̪: 'द',
  d̪ʱ: 'ध',
  n: 'न',
  p: 'प',
  pʰ: 'फ',
  b: 'ब',
  bʱ: 'भ',
  m: 'म',
  j: 'य',
  ɾ: 'र',
  l: 'ल',
  ʋ: 'व',
  ʃ: 'श',
  s: 'स',
  ɦ: 'ह',
  q: 'क़',
  x: 'ख़',
  ɣ: 'ग़',
  z: 'ज़',
  ɽ: 'ड़',
  ɽʱ: 'ढ़',
  f: 'फ़',
};
const HI_VOWELS = {
  ə: ['अ', ''],
  a: ['आ', 'ा'],
  ɪ: ['इ', 'ि'],
  i: ['ई', 'ी'],
  ʊ: ['उ', 'ु'],
  u: ['ऊ', 'ू'],
  e: ['ए', 'े'],
  ɛ: ['ऐ', 'ै'],
  o: ['ओ', 'ो'],
  ɔ: ['औ', 'ौ'],
};

function hindi(tokens) {
  let text = '';
  tokens.forEach((token, i) => {
    if (token.kind === 'vowel') {
      const vowel = HI_VOWELS[token.base] ?? HI_VOWELS.ə;
      text += vowel[tokens[i - 1]?.kind === 'consonant' ? 1 : 0];
      if (token.nasalized) {
        text += 'ँ';
      }
    } else {
      text += HI_CONSONANTS[token.symbol] ?? HI_CONSONANTS[token.base] ?? '';
      if (tokens[i + 1]?.kind === 'consonant') {
        text += '्';
      }
      // Explicit final virama avoids creating a final schwa in a word
      // whose heard form has no vowel (or only one other vowel).
      if (i === tokens.length - 1) {
        text += '्';
      }
    }
  });
  return text;
}

function english(tokens) {
  let text = '';
  for (let i = 0; i < tokens.length; i++) {
    const pair = tokens[i].base + (tokens[i + 1]?.base ?? '');
    if (i + 1 < tokens.length && ENGLISH_SOUND_SPELLINGS[pair]) {
      text += ENGLISH_SOUND_SPELLINGS[pair];
      i++;
    } else {
      text +=
        ENGLISH_SOUND_SPELLINGS[tokens[i].symbol] ??
        ENGLISH_SOUND_SPELLINGS[tokens[i].base] ??
        '';
    }
  }
  return text;
}

let chineseInverse;
function inverseChinese() {
  if (!chineseInverse) {
    const best = new Map();
    const { wordCount } = getCounts('zh');
    for (const [char, readings] of characterReadings()) {
      for (const reading of readings) {
        const syllable = pinyinSyllableToIpa(reading);
        if (!syllable) {
          continue;
        }
        const ipa = syllableWithTone(syllable, true);
        const count = wordCount(char) ?? 0;
        if (!best.has(ipa) || count > best.get(ipa).count) {
          best.set(ipa, { char, count, reading, tokens: parseIpa(ipa).tokens });
        }
      }
    }
    chineseInverse = [...best.values()];
  }
  return chineseInverse;
}

function chinese(tokens) {
  return syllabifyTokens(tokens, { language: 'zh' })
    .map((syllable) => {
      let best = null;
      let cost = Infinity;
      for (const item of inverseChinese()) {
        if (item.tokens.length !== syllable.length) {
          continue;
        }
        const distance = syllable.reduce(
          (sum, token, i) =>
            sum +
            phoneDistance(token, item.tokens[i]) +
            (token.symbol !== item.tokens[i].symbol ? 0.001 : 0),
          0
        );
        if (distance < cost || (distance === cost && item.count > best.count)) {
          best = item;
          cost = distance;
        }
      }
      return best?.char ?? '';
    })
    .join('');
}

/** Spell one unknown word from parsed sound tokens, without a word lookup. */
export function spellSounds(tokens, language = 'en') {
  checkLanguage(language);
  switch (language) {
    case 'ru':
      return russian(tokens);
    case 'hi':
      return hindi(tokens);
    case 'zh':
      return chinese(tokens);
    default:
      return english(tokens) || formatIpa(tokens);
  }
}
