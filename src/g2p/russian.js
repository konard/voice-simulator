/**
 * Russian grapheme-to-phoneme conversion.
 *
 * Implements the core of standard Moscow pronunciation: lexical stress
 * (dictionary, ё, or user marks), vowel reduction (akanye/ikanye),
 * consonant palatalization before soft vowels and ь, iotation, final
 * devoicing, regressive voicing assimilation and common cluster
 * simplifications.
 */

import { RUSSIAN_EXCEPTIONS } from './russian-stress.js';
import { russianHomograph } from './russian-homographs.js';
import { RU_GUESS } from './lexicon/ru.js';
import {
  lexiconFor,
  registerShippedSpeaker,
  userPronunciation,
} from './lexicon.js';

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

const VERB_ENDINGS =
  'ть ти чь ать ять еть ить уть ыть оть у ю ешь ет ем ете ут ют ёшь ёт ём ' +
  'ёте ишь ит им ите ат ят аю аешь ает аем аете ают яю яешь яет яем яете ' +
  'яют ею еешь еет еем еете еют ую уешь ует уем уете уют л ла ло ли ал ала ' +
  'ало али ял яла яло яли ил ила ило или ел ела ело ели ул ула уло ули ыл ' +
  'ыла ыло ыли й йте и ь ьте ай айте яй яйте ей ейте уй уйте я а в вши ав ' +
  'ив ев яв ая ия ши ув';
const PARTICIPLE_ENDINGS = [
  'щ',
  'ющ',
  'ущ',
  'ящ',
  'ащ',
  'вш',
  'ш',
  'нн',
  'енн',
  'ённ',
  'анн',
  'янн',
  'т',
  'ем',
  'им',
  'ом',
].flatMap((stem) =>
  'ий ая ее ие его ей ему им их ими ую ем'
    .split(' ')
    .map((ending) => stem + ending)
);
const BASE_ENDINGS = [
  // Nouns.
  '',
  'а',
  'я',
  'о',
  'е',
  'ё',
  'ы',
  'и',
  'у',
  'ю',
  'ь',
  'ой',
  'ей',
  'ёй',
  'ою',
  'ею',
  'ью',
  'ом',
  'ем',
  'ём',
  'ам',
  'ям',
  'ами',
  'ями',
  'ах',
  'ях',
  'ов',
  'ев',
  'ёв',
  'ия',
  'ии',
  'ию',
  'ие',
  'ий',
  'ией',
  'ием',
  'иям',
  'иями',
  'иях',
  'ья',
  'ье',
  'ьи',
  'ью',
  'ьям',
  'ьями',
  'ьях',
  'ьев',
  'ьё',
  'ьём',
  // Adjectives and short forms.
  'ый',
  'ий',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ого',
  'его',
  'ому',
  'ему',
  'ым',
  'им',
  'ую',
  'юю',
  'ых',
  'их',
  'ыми',
  'ими',
  'ен',
  'ён',
  'ейш',
  'айш',
  // Verbs, gerunds and participles.
  ...VERB_ENDINGS.split(' '),
  ...PARTICIPLE_ENDINGS,
];

/**
 * The endings `findRussianStress()` splits off a word to find its stem in
 * `RU_STEMS`: case, number and gender endings of nouns and adjectives,
 * tense, person, imperative, gerund and participle endings of verbs, each
 * also with `ся` and `сь`. The empty ending is allowed.
 * @type {readonly string[]}
 */
export const RUSSIAN_ENDINGS = Object.freeze([
  ...new Set(
    BASE_ENDINGS.flatMap((ending) => [ending, `${ending}ся`, `${ending}сь`])
  ),
]);
const ENDINGS = new Set(RUSSIAN_ENDINGS);

/** The stressed vowel of a whole form (`a` the first vowel, `z` the last). */
function formStress(letters, vowels) {
  const letter = lexiconFor('ru', 'forms').lookup(letters)?.[0];
  if (!letter) {
    return undefined;
  }
  return letter === 'z' ? vowels - 1 : letter.charCodeAt(0) - 97;
}

/**
 * The stressed vowel from the longest stem of `RU_STEMS` followed by an
 * ending of `RUSSIAN_ENDINGS`: a vowel of the stem, or the first vowel of
 * the ending (the last of the stem when the ending has none); with the
 * length of the stem as `{stress, stem}`.
 */
function stemStress(letters) {
  const stems = lexiconFor('ru', 'stems');
  for (let cut = letters.length; cut > 0; cut--) {
    const ending = letters.slice(cut);
    // A stem that ends in a vowel takes a real ending (`встреч+а|ть` does
    // not read `встреча`).
    const vowelStem = !ending && VOWEL_LETTERS.includes(letters[cut - 1]);
    const letter = ENDINGS.has(ending) && !vowelStem
      ? stems.lookup(letters.slice(0, cut))?.[0]
      : undefined;
    if (letter) {
      const before = countVowels(letters.slice(0, cut));
      if (letter !== '+') {
        return { stress: letter.charCodeAt(0) - 97, stem: cut };
      }
      return {
        stress: countVowels(ending) > 0 ? before : before - 1,
        stem: cut,
      };
    }
  }
  return undefined;
}

/**
 * Stress from the lexicon: `{stress, source}` or undefined; with
 * `formsOnly`, from the whole forms alone.
 */
function lexiconStress(letters, vowels, formsOnly = false) {
  const form = formStress(letters, vowels);
  if (form !== undefined) {
    return { stress: form, source: 'dictionary' };
  }
  const stem = formsOnly ? undefined : stemStress(letters);
  return stem === undefined ? undefined : { ...stem, source: 'morphology' };
}

/**
 * A word written with `е` for `ё`: the one spelling with a `ё` that the
 * lexicon stresses on that `ё` (`еще` → `ещё`), or undefined when there
 * is none or more than one. With `formsOnly`, only whole forms count.
 */
function restoreYo(letters, vowels, formsOnly = false) {
  const found = [];
  [...letters].forEach((letter, index) => {
    if (letter !== 'е') {
      return;
    }
    const candidate = `${letters.slice(0, index)}ё${letters.slice(index + 1)}`;
    const known = lexiconStress(candidate, vowels, formsOnly);
    if (known?.stress === countVowels(letters.slice(0, index))) {
      found.push({ letters: candidate, yo: index, ...known });
    }
  });
  return found.length === 1 ? found[0] : undefined;
}

function countVowels(text) {
  return [...text].filter((letter) => VOWEL_LETTERS.includes(letter)).length;
}

let guessTable;

/** Ending → stressed vowel counted from the end, from `RU_GUESS`. */
function guessEndings() {
  guessTable ??= new Map(
    RU_GUESS.flatMap((endings, fromEnd) =>
      endings
        .split(' ')
        .filter(Boolean)
        .map((ending) => [ending, fromEnd])
    )
  );
  return guessTable;
}

/**
 * Guess the stressed vowel of an unknown word from the table `RU_GUESS`
 * that the build derives from the lexicon (endings of 2 to 6 letters, the
 * longest wins); without a match, the vowel before the last.
 * @param {string} word lower case
 * @param {number} [vowels] the number of vowels of `word`
 * @returns {number}
 */
export function guessRussianStress(word, vowels = countVowels(word)) {
  const table = guessEndings();
  for (let length = Math.min(6, word.length - 1); length >= 2; length--) {
    const fromEnd = table.get(word.slice(-length));
    if (fromEnd !== undefined && fromEnd < vowels) {
      return vowels - 1 - fromEnd;
    }
  }
  return Math.max(0, vowels - 2);
}

/** Letters of a word with its stress marks read: `+`, U+0301, ё, й. */
function readMarks(rawWord) {
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
      // NFD splits й into и and a breve: the и was counted as a vowel.
      letters = `${letters.slice(0, -1)}й`;
      vowels--;
    }
  }
  return { letters, stress, vowels };
}

/** The stress of a marked form (`зам+ок`, `всё`) of a homograph. */
function homographStress(marked) {
  const { letters, stress } = readMarks(marked);
  const yo = letters.indexOf('ё');
  return {
    letters,
    stress: stress >= 0 ? stress : countVowels(letters.slice(0, yo)),
  };
}

/**
 * Split a raw word into letters and the index (among vowels) of the
 * stress. In this order: a mark typed by the user (`+` before a vowel or
 * U+0301 after it), a typed `ё`, a homograph chosen by `context`
 * (`RUSSIAN_HOMOGRAPHS`), a whole form (`RU_FORMS`), a stem and an ending
 * (`RU_STEMS`, `RUSSIAN_ENDINGS`), the same with one `е` read as `ё` when
 * exactly one such spelling is known (`еще` → `ещё`), and the guess of
 * `guessRussianStress()`.
 * @param {string} rawWord
 * @param {{before?: string[], after?: string[]}} [context] the words around
 *   the word (see `wordContexts()` in src/g2p/index.js)
 * @returns {{letters: string, stress: number, vowels: number,
 *   source: 'user'|'dictionary'|'morphology'|'rules'}} `letters` with a
 *   restored `ё`
 */
export function findRussianStress(rawWord, context = {}) {
  const read = readMarks(rawWord);
  const { vowels } = read;
  const result = (letters, stress, source) => ({
    letters,
    stress: vowels <= 1 ? 0 : stress,
    vowels,
    source: vowels <= 1 && source === 'rules' ? 'dictionary' : source,
  });
  if (read.stress >= 0) {
    return result(read.letters, read.stress, 'user');
  }
  const { letters } = read;
  if (letters.includes('ё')) {
    const stress = countVowels(letters.slice(0, letters.indexOf('ё')));
    return result(letters, stress, 'dictionary');
  }
  const homograph = russianHomograph(letters, context);
  if (homograph) {
    const chosen = homographStress(homograph);
    return result(chosen.letters, chosen.stress, 'dictionary');
  }
  // A whole form first, then the same form with ё (`живет` → `живёт`,
  // before the stem `жив` with the ending `ет`), then the longer of the
  // stems with and without ё; on a tie the ё wins when it is in the stem
  // (`зеленый`: `зелён|ый`, not `з+елен|ь`; `борьбе`: not `борьб|ё`).
  const yo = letters.includes('е');
  const stem = lexiconStress(letters, vowels);
  const yoStem = yo ? restoreYo(letters, vowels) : undefined;
  const yoWins =
    yoStem &&
    (!stem ||
      yoStem.stem > stem.stem ||
      (yoStem.stem === stem.stem && yoStem.yo < yoStem.stem));
  const known =
    lexiconStress(letters, vowels, true) ??
    (yo ? restoreYo(letters, vowels, true) : undefined) ??
    (yoWins ? yoStem : stem);
  if (known) {
    return result(known.letters ?? letters, known.stress, known.source);
  }
  return result(letters, guessRussianStress(letters, vowels), 'rules');
}

/**
 * Northern okanye (issue 57): an unstressed о after a hard consonant keeps
 * its quality; it is not reduced to ɐ or ə.
 */
function vowelQuality(letter, context) {
  const { stressed, soft, initial, okanye } = context;
  if (okanye && !stressed && letter === 'о' && !soft && !initial) {
    return 'o';
  }
  return reduceVowel(letter, context);
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
  const quality = vowelQuality(letter === 'и' && !soft ? 'ы' : letter, {
    stressed: vowelIndex === stress,
    pretonic: vowelIndex === stress - 1,
    soft: soft && letter !== 'и' ? true : soft,
    initial: !previousPhone,
    final: context.final,
    okanye: context.okanye && !context.afterVowel,
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

function lettersToPhones(letters, stress, vowels, okanye = false) {
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
          okanye,
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

/** Voicing pairs with the southern fricative ɣ ~ x (issue 57). */
const FRICATIVE_G_DEVOICE = { ...DEVOICE, ɣ: 'x' };
const FRICATIVE_G_VOICE = { ...VOICE, x: 'ɣ' };

function setVoicing(phone, voiced, tables) {
  const [base, mark] = splitPalatal(phone);
  const table = voiced ? tables.voice : tables.devoice;
  return table[base] ? `${table[base]}${mark}` : phone;
}

function isObstruent(phone, tables) {
  const [base] = splitPalatal(phone);
  return base in tables.devoice || base in tables.voice;
}

/**
 * Final devoicing and regressive voicing assimilation (right to left),
 * inside one word. Voicing across a clitic boundary (`из дома` ɪz ˈdomə,
 * `как же` kaɡ ʐɨ) is done in `russian-clitics.js`.
 */
function assimilateVoicing(
  phones,
  tables = { devoice: DEVOICE, voice: VOICE }
) {
  const result = [...phones];
  for (let index = result.length - 1; index >= 0; index--) {
    if (!isObstruent(result[index], tables)) {
      continue;
    }
    const next = result[index + 1];
    if (next === undefined) {
      result[index] = setVoicing(result[index], false, tables);
    } else if (isObstruent(next, tables) && !/^v/.test(next)) {
      const [nextBase] = splitPalatal(next);
      result[index] = setVoicing(
        result[index],
        nextBase in tables.devoice,
        tables
      );
    }
  }
  return result;
}

/** Southern fricative г (issue 57): ɡ → ɣ before voicing assimilation. */
function fricativeG(phones) {
  return phones.map((phone) =>
    phone === 'ɡ' || phone === 'ɡʲ' ? phone.replace('ɡ', 'ɣ') : phone
  );
}

/**
 * Pronounce one Russian word.
 * @param {string} word
 * @param {{okanye?: boolean, fricativeG?: boolean, before?: string[],
 *   after?: string[], sentence?: string[]}} [options] Switches of regional
 *   accents (issue 57): okanye keeps an unstressed о after a hard consonant
 *   (northern, хорошо xoroˈʂo); fricativeG makes г the fricative ɣ,
 *   devoiced to x (southern, город ˈɣorət, снег snʲex). `before`, `after`
 *   and `sentence` are the words around the word, which choose the stress
 *   of a homograph (issue 48, `findRussianStress()`).
 * @returns {{ipa: string,
 *   source: 'user'|'exception'|'dictionary'|'morphology'|'rules'}} `user`
 *   for a user lexicon or a typed stress mark
 */
export function russianWordToIpa(word, options = {}) {
  const { okanye = false, fricativeG: fricative = false } = options;
  const { letters, stress, source } = findRussianStress(word, options);
  const user = userPronunciation('ru', letters);
  if (user) {
    return { ipa: user, source: 'user' };
  }
  if (RUSSIAN_EXCEPTIONS[letters] && source !== 'user') {
    return { ipa: RUSSIAN_EXCEPTIONS[letters], source: 'exception' };
  }
  const prepared = prepareLetters(letters);
  const plain = lettersToPhones(
    prepared,
    stress,
    countVowels(prepared),
    okanye
  );
  const phones = fricative
    ? assimilateVoicing(fricativeG(plain), {
        devoice: FRICATIVE_G_DEVOICE,
        voice: FRICATIVE_G_VOICE,
      })
    : assimilateVoicing(plain);
  return { ipa: phones.join(''), source };
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

registerShippedSpeaker('ru', (word) => russianWordToIpa(word).ipa);
