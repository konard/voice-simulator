/**
 * Russian grapheme-to-phoneme conversion.
 *
 * Implements the core of standard Moscow pronunciation: lexical stress
 * (dictionary, ё, or user marks), vowel reduction (akanye/ikanye),
 * consonant palatalization before soft vowels and ь, iotation, final
 * devoicing, regressive voicing assimilation and common cluster
 * simplifications.
 */

import { RUSSIAN_EXCEPTIONS, RUSSIAN_STRESS } from './russian-stress.js';

const VOWEL_LETTERS = 'аоуыэяёюие';
const SOFT_VOWELS = 'яёюие';

const CONSONANTS = {
  б: 'b',
  в: 'v',
  г: 'ɡ',
  д: 'd',
  з: 'z',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  ф: 'f',
  х: 'x',
};

const ALWAYS_HARD = { ж: 'ʐ', ш: 'ʂ', ц: 't͡s' };
const ALWAYS_SOFT = { ч: 't͡ɕ', щ: 'ɕː', й: 'j' };

const STRESSED_VOWELS = {
  а: 'a',
  о: 'o',
  у: 'u',
  ы: 'ɨ',
  э: 'ɛ',
  е: 'e',
  ё: 'o',
  ю: 'u',
  я: 'a',
  и: 'i',
};

const DEVOICE = {
  b: 'p',
  v: 'f',
  ɡ: 'k',
  d: 't',
  z: 's',
  ʐ: 'ʂ',
};
const VOICE = Object.fromEntries(
  Object.entries(DEVOICE).map(([voiced, voiceless]) => [voiceless, voiced])
);

const CLUSTERS = [
  ['вств', 'ств'],
  ['стн', 'сн'],
  ['здн', 'зн'],
  ['лнц', 'нц'],
  ['сч', 'щ'],
  ['зч', 'щ'],
  ['жч', 'щ'],
  ['ться', 'ца'],
  ['тся', 'ца'],
  ['дц', 'ц'],
  ['тц', 'ц'],
];

const GENITIVE_EXCEPTIONS = new Set([
  'много',
  'немного',
  'строго',
  'дорого',
  'убого',
  'ого',
]);

let stressDictionary = null;

function getStressDictionary() {
  if (!stressDictionary) {
    stressDictionary = new Map(
      RUSSIAN_STRESS.split(' ').map((entry) => [
        entry.replace('+', ''),
        countVowels(entry.slice(0, entry.indexOf('+'))),
      ])
    );
  }
  return stressDictionary;
}

function countVowels(text) {
  return [...text].filter((letter) => VOWEL_LETTERS.includes(letter)).length;
}

/** Guess stress for unknown words from common suffixes, else penultimate. */
function guessStress(word, vowelCount) {
  const suffixes = [
    ['ация', 0],
    ['ировать', 0],
    ['ание', 0],
    ['ение', 0],
    ['тель', 1],
    ['ист', 0],
    ['изм', 0],
  ];
  for (const [suffix, offset] of suffixes) {
    if (word.endsWith(suffix) && word.length > suffix.length) {
      const before = countVowels(word.slice(0, -suffix.length));
      return Math.max(0, before - offset);
    }
  }
  return Math.max(0, vowelCount - 2);
}

/**
 * Split a raw word into letters and the index (among vowels) of the stress.
 * Accepts `+` before a vowel or U+0301 after it.
 */
export function findRussianStress(rawWord) {
  const marked = rawWord.toLowerCase().normalize('NFD');
  let letters = '';
  let stress = -1;
  let vowels = 0;
  for (const char of marked) {
    if (char === '+') {
      stress = vowels;
    } else if (char === '́') {
      stress = vowels - 1;
    } else if (char === '̈' && letters.endsWith('е')) {
      letters = `${letters.slice(0, -1)}ё`;
    } else if (char !== '̆' || !letters.endsWith('и')) {
      letters += char;
      vowels += VOWEL_LETTERS.includes(char) ? 1 : 0;
    } else {
      letters = `${letters.slice(0, -1)}й`;
    }
  }
  if (stress < 0 && letters.includes('ё')) {
    stress = countVowels(letters.slice(0, letters.indexOf('ё')));
  }
  if (stress < 0) {
    stress = getStressDictionary().get(letters) ?? guessStress(letters, vowels);
  }
  return { letters, stress: vowels <= 1 ? 0 : stress, vowels };
}

function reduceVowel(letter, { stressed, pretonic, soft, initial, final }) {
  if (stressed) {
    return STRESSED_VOWELS[letter];
  }
  if (letter === 'у' || letter === 'ю') {
    return 'ʊ';
  }
  if (letter === 'ы') {
    return 'ɨ';
  }
  if (soft) {
    return final && letter !== 'и' ? 'ə' : 'ɪ';
  }
  if (letter === 'и' || letter === 'е' || letter === 'э') {
    return initial ? 'ɪ' : 'ɨ';
  }
  return pretonic || initial ? 'ɐ' : 'ə';
}

function consonantPhone(letter, next) {
  if (ALWAYS_HARD[letter]) {
    return ALWAYS_HARD[letter];
  }
  if (ALWAYS_SOFT[letter]) {
    return ALWAYS_SOFT[letter];
  }
  const soft =
    next === 'ь' || (next !== undefined && SOFT_VOWELS.includes(next));
  if (letter === 'л') {
    return soft ? 'lʲ' : 'ɫ';
  }
  return soft ? `${CONSONANTS[letter]}ʲ` : CONSONANTS[letter];
}

function prepareLetters(letters) {
  let prepared = letters;
  for (const [cluster, replacement] of CLUSTERS) {
    prepared = prepared.replaceAll(cluster, replacement);
  }
  if (/(?:о|е)го$/.test(prepared) && !GENITIVE_EXCEPTIONS.has(prepared)) {
    prepared = `${prepared.slice(0, -2)}во`;
  }
  return prepared;
}

function vowelPhones(letter, context) {
  const { previousPhone, previousLetter, vowelIndex, stress } = context;
  const iotated =
    SOFT_VOWELS.includes(letter) &&
    letter !== 'и' &&
    (!previousPhone || 'ьъ'.includes(previousLetter) || context.afterVowel);
  const soft =
    iotated ||
    (SOFT_VOWELS.includes(letter) &&
      !['ʐ', 'ʂ', 't͡s'].includes(previousPhone)) ||
    ['t͡ɕ', 'ɕː', 'j'].includes(previousPhone);
  const quality = reduceVowel(letter === 'и' && !soft ? 'ы' : letter, {
    stressed: vowelIndex === stress,
    pretonic: vowelIndex === stress - 1,
    soft: soft && letter !== 'и' ? true : soft,
    initial: !previousPhone,
    final: context.final,
  });
  return iotated ? ['j', quality] : [quality];
}

/** Insert ˈ before the onset consonant of the stressed syllable. */
const VOWEL_PHONE = /[aeiouɨəɐɪʊɛɔ]/;
const ONSET_SECOND = /^(?:[rlɫmnvj]|ʋ)/;

/** Insert the stress mark before the onset: one consonant or C + sonorant. */
function markStress(phones, afterVowel) {
  if (afterVowel) {
    phones.push('ˈ');
    return;
  }
  const lastVowel = phones.findLastIndex((phone) => VOWEL_PHONE.test(phone));
  const cluster = phones.length - lastVowel - 1;
  const twoConsonants =
    cluster >= 2 &&
    ONSET_SECOND.test(phones.at(-1)) &&
    !ONSET_SECOND.test(phones.at(-2));
  const onset = lastVowel < 0 ? cluster : twoConsonants ? 2 : 1;
  phones.splice(phones.length - onset, 0, 'ˈ');
}

function lettersToPhones(letters, stress, vowels) {
  const phones = [];
  let vowelIndex = 0;
  let afterVowel = false;
  [...letters].forEach((letter, index) => {
    const next = letters[index + 1];
    if (VOWEL_LETTERS.includes(letter)) {
      if (vowelIndex === stress && vowels > 1) {
        markStress(phones, afterVowel);
      }
      phones.push(
        ...vowelPhones(letter, {
          previousPhone: phones.filter((phone) => phone !== 'ˈ').at(-1),
          previousLetter: letters[index - 1],
          afterVowel,
          vowelIndex,
          stress,
          vowels,
          final: index === letters.length - 1,
        })
      );
      vowelIndex++;
      afterVowel = true;
    } else if (
      CONSONANTS[letter] ||
      ALWAYS_HARD[letter] ||
      ALWAYS_SOFT[letter]
    ) {
      phones.push(consonantPhone(letter, next));
      afterVowel = false;
    } else if (letter === 'ь' || letter === 'ъ') {
      afterVowel = false;
    }
  });
  return phones;
}

function splitPalatal(phone) {
  return phone.endsWith('ʲ') ? [phone.slice(0, -1), 'ʲ'] : [phone, ''];
}

function setVoicing(phone, voiced) {
  const [base, mark] = splitPalatal(phone);
  const table = voiced ? VOICE : DEVOICE;
  return table[base] ? `${table[base]}${mark}` : phone;
}

function isObstruent(phone) {
  const [base] = splitPalatal(phone);
  return base in DEVOICE || base in VOICE;
}

/** Final devoicing and regressive voicing assimilation (right to left). */
function assimilateVoicing(phones) {
  const result = [...phones];
  for (let index = result.length - 1; index >= 0; index--) {
    if (!isObstruent(result[index])) {
      continue;
    }
    const next = result[index + 1];
    if (next === undefined) {
      result[index] = setVoicing(result[index], false);
    } else if (isObstruent(next) && !/^v/.test(next)) {
      const [nextBase] = splitPalatal(next);
      result[index] = setVoicing(result[index], nextBase in DEVOICE);
    }
  }
  return result;
}

/**
 * Pronounce one Russian word.
 * @param {string} word
 * @returns {{ipa: string, source: 'exception'|'dictionary'|'rules'}}
 */
export function russianWordToIpa(word) {
  const { letters, stress, vowels } = findRussianStress(word);
  if (RUSSIAN_EXCEPTIONS[letters] && !/\+|\u0301/.test(word.normalize('NFD'))) {
    return { ipa: RUSSIAN_EXCEPTIONS[letters], source: 'exception' };
  }
  const prepared = prepareLetters(letters);
  const phones = assimilateVoicing(
    lettersToPhones(prepared, stress, countVowels(prepared))
  );
  const known = getStressDictionary().has(letters) || letters.includes('ё');
  return {
    ipa: phones.join(''),
    source: known || vowels <= 1 ? 'dictionary' : 'rules',
  };
}

const RU_ONES = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const RU_TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const RU_HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

export function russianBelowThousand(value, feminine) {
  const words = [];
  if (value >= 100) {
    words.push(RU_HUNDREDS[Math.floor(value / 100)]);
  }
  const rest = value % 100;
  if (rest >= 20) {
    words.push(RU_TENS[Math.floor(rest / 10)]);
  }
  const unit = rest >= 20 ? rest % 10 : rest;
  if (unit > 0 || words.length === 0) {
    const femaleForms = { 1: 'одна', 2: 'две' };
    words.push((feminine && femaleForms[unit]) || RU_ONES[unit]);
  }
  return words;
}

function thousandsWord(value) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return 'тысяч';
  }
  if (last === 1) {
    return 'тысяча';
  }
  return last >= 2 && last <= 4 ? 'тысячи' : 'тысяч';
}

/**
 * Spell an integer below one million in Russian (nominative case).
 * @param {number} value
 * @returns {string[]}
 */
export function russianNumberWords(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1e6) {
    return [...String(value)].flatMap((digit) => RU_ONES[Number(digit)] ?? []);
  }
  if (value < 1000) {
    return russianBelowThousand(value, false);
  }
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  return [
    ...russianBelowThousand(thousands, true),
    thousandsWord(thousands),
    ...(rest ? russianBelowThousand(rest, false) : []),
  ];
}
