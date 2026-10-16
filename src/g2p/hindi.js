/**
 * Hindi (Devanagari) grapheme-to-phoneme conversion.
 *
 * Devanagari is an abugida: each consonant letter carries an inherent
 * schwa that vowel signs (matras) replace and the virama removes. Spoken
 * Hindi drops many inherent schwas, so after transliteration we apply the
 * standard schwa-deletion rule (word-final, then medial V C _ C V scanning
 * right to left without creating three-consonant clusters).
 */

const CONSONANTS = {
  क: 'k',
  ख: 'kʰ',
  ग: 'ɡ',
  घ: 'ɡʱ',
  ङ: 'ŋ',
  च: 't͡ʃ',
  छ: 't͡ʃʰ',
  ज: 'd͡ʒ',
  झ: 'd͡ʒʱ',
  ञ: 'ɲ',
  ट: 'ʈ',
  ठ: 'ʈʰ',
  ड: 'ɖ',
  ढ: 'ɖʱ',
  ण: 'ɳ',
  त: 't̪',
  थ: 't̪ʰ',
  द: 'd̪',
  ध: 'd̪ʱ',
  न: 'n',
  प: 'p',
  फ: 'pʰ',
  ब: 'b',
  भ: 'bʱ',
  म: 'm',
  य: 'j',
  र: 'ɾ',
  ल: 'l',
  व: 'ʋ',
  श: 'ʃ',
  ष: 'ʃ',
  स: 's',
  ह: 'ɦ',
};

/** Consonants written with a nukta (mostly Perso-Arabic and English loans). */
const NUKTA_CONSONANTS = {
  क: 'q',
  ख: 'x',
  ग: 'ɣ',
  ज: 'z',
  ड: 'ɽ',
  ढ: 'ɽʱ',
  फ: 'f',
  य: 'j',
};

const INDEPENDENT_VOWELS = {
  अ: 'ə',
  आ: 'aː',
  इ: 'ɪ',
  ई: 'iː',
  उ: 'ʊ',
  ऊ: 'uː',
  ऋ: 'rɪ',
  ए: 'eː',
  ऐ: 'ɛː',
  ओ: 'oː',
  औ: 'ɔː',
  ऑ: 'ɔ',
};

const MATRAS = {
  'ा': 'aː',
  'ि': 'ɪ',
  'ी': 'iː',
  'ु': 'ʊ',
  'ू': 'uː',
  'ृ': 'rɪ',
  'े': 'eː',
  'ै': 'ɛː',
  'ो': 'oː',
  'ौ': 'ɔː',
  'ॉ': 'ɔ',
};

const VIRAMA = '्';
const NUKTA = '़';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';

/** Homorganic nasal for anusvara before a consonant. */
function homorganicNasal(consonant) {
  if (/^[kɡŋqxɣ]/.test(consonant)) {
    return 'ŋ';
  }
  if (/^(?:t͡ʃ|d͡ʒ|ɲ)/.test(consonant)) {
    return 'ɲ';
  }
  if (/^[ʈɖɳɽ]/.test(consonant)) {
    return 'ɳ';
  }
  return /^[pbm]/.test(consonant) ? 'm' : 'n';
}

function addVowelMark(units, mark, final) {
  const last = units.at(-1);
  if (!last || last.type !== 'vowel') {
    return;
  }
  if (mark === VISARGA) {
    // Visarga is only audible word-finally in Sanskrit loans.
    if (final) {
      units.push({ type: 'consonant', ipa: 'ɦ' });
    }
  } else {
    last.nasal = true;
  }
}

/** Transliterate into consonant / vowel units with inherent schwas. */
function toUnits(word) {
  const units = [];
  const chars = [...word.normalize('NFD')];
  chars.forEach((char, index) => {
    const last = units.at(-1);
    if (CONSONANTS[char]) {
      const nukta = chars[index + 1] === NUKTA && NUKTA_CONSONANTS[char];
      units.push({ type: 'consonant', ipa: nukta || CONSONANTS[char] });
      units.push({ type: 'vowel', ipa: 'ə', inherent: true });
    } else if (INDEPENDENT_VOWELS[char]) {
      units.push({ type: 'vowel', ipa: INDEPENDENT_VOWELS[char] });
    } else if (MATRAS[char] && last?.inherent) {
      last.ipa = MATRAS[char];
      last.inherent = false;
    } else if (char === VIRAMA && last?.inherent) {
      units.pop();
    } else if (char === ANUSVARA) {
      units.push({ type: 'anusvara' });
    } else if (char === CHANDRABINDU || char === VISARGA) {
      addVowelMark(units, char, index === chars.length - 1);
    }
  });
  return resolveAnusvara(units);
}

function resolveAnusvara(units) {
  return units.flatMap((unit, index) => {
    if (unit.type !== 'anusvara') {
      return [unit];
    }
    const next = units[index + 1];
    const previous = units[index - 1];
    if (next?.type === 'consonant' && !/^[jɾlʋʃsɦ]/.test(next.ipa)) {
      if (previous?.inherent) {
        previous.inherent = false;
      }
      return [{ type: 'consonant', ipa: homorganicNasal(next.ipa) }];
    }
    if (previous?.type === 'vowel') {
      previous.nasal = true;
      previous.inherent = false;
    }
    return [];
  });
}

function isConsonant(unit) {
  return unit?.type === 'consonant';
}

function isVowel(unit) {
  return unit?.type === 'vowel';
}

/** Remove inherent schwas that are not pronounced in Hindi. */
export function deleteSchwas(units) {
  const kept = [...units];
  const last = kept.at(-1);
  const vowelCount = kept.filter(isVowel).length;
  if (last?.inherent && vowelCount > 1) {
    kept.pop();
  }
  for (let index = kept.length - 2; index >= 2; index--) {
    const unit = kept[index];
    const deletable =
      unit.inherent &&
      isConsonant(kept[index - 1]) &&
      isVowel(kept[index - 2]) &&
      isConsonant(kept[index + 1]) &&
      isVowel(kept[index + 2]);
    if (deletable) {
      kept.splice(index, 1);
      index--;
    }
  }
  return kept;
}

/**
 * Pronounce one Hindi word written in Devanagari.
 * @param {string} word
 * @returns {{ipa: string, source: 'rules'}}
 */
export function hindiWordToIpa(word) {
  const units = deleteSchwas(toUnits(word));
  const ipa = units
    .map((unit) =>
      unit.nasal
        ? `${unit.ipa.replace('ː', '')}̃${unit.ipa.includes('ː') ? 'ː' : ''}`
        : unit.ipa
    )
    .join('');
  return { ipa, source: 'rules' };
}

const HINDI_DIGITS = [
  'शून्य',
  'एक',
  'दो',
  'तीन',
  'चार',
  'पाँच',
  'छह',
  'सात',
  'आठ',
  'नौ',
  'दस',
];

/**
 * Spell a number in Hindi: words up to ten, otherwise digit by digit.
 * @param {number} value
 * @returns {string[]}
 */
export function hindiNumberWords(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 10) {
    return [HINDI_DIGITS[value]];
  }
  return [...String(value)].flatMap((digit) => HINDI_DIGITS[digit] ?? []);
}

/** Convert Devanagari digits (०-९) to ASCII. */
export function normalizeDevanagariDigits(text) {
  return text.replace(/[०-९]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0966)
  );
}
