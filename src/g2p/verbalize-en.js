/**
 * English verbaliser: numbers, ordinals, years, times, dates, money,
 * units, symbols, abbreviations and letter names as English words.
 *
 * Words are strings, or `{text, ipa}` when the generated word is not in
 * the dictionary and the spelling rules would misread it (ordinals such
 * as "thirtieth", "o'clock", currency names).
 */

import { englishNumberWords } from './english-rules.js';
import { englishWordToIpa } from './english.js';

const ORDINAL_IRREGULAR = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

const DIGIT_WORDS = 'zero one two three four five six seven eight nine'.split(
  ' '
);

/** Letter names (US); `z` is "zed" outside the US. */
export const LETTER_IPA = {
  a: 'ˈeɪ',
  b: 'ˈbi',
  c: 'ˈsi',
  d: 'ˈdi',
  e: 'ˈi',
  f: 'ˈɛf',
  g: 'ˈd͡ʒi',
  h: 'ˈeɪt͡ʃ',
  i: 'ˈaɪ',
  j: 'ˈd͡ʒeɪ',
  k: 'ˈkeɪ',
  l: 'ˈɛl',
  m: 'ˈɛm',
  n: 'ˈɛn',
  o: 'ˈoʊ',
  p: 'ˈpi',
  q: 'ˈkju',
  r: 'ˈɑɹ',
  s: 'ˈɛs',
  t: 'ˈti',
  u: 'ˈju',
  v: 'ˈvi',
  w: 'ˈdʌbəlju',
  x: 'ˈɛks',
  y: 'ˈwaɪ',
  z: 'ˈzi',
};

/** Derive a word's IPA by appending a suffix to its dictionary form. */
function suffixed(text, base, ipaSuffix) {
  if (englishWordToIpa(text).source === 'dictionary') {
    return text;
  }
  return { text, ipa: englishWordToIpa(base).ipa + ipaSuffix };
}

function cardinal(value) {
  return englishNumberWords(value);
}

function digits(text) {
  return [...text].map((digit) => DIGIT_WORDS[Number(digit)]);
}

function ordinalWord(base) {
  if (ORDINAL_IRREGULAR[base]) {
    return ORDINAL_IRREGULAR[base];
  }
  if (base.endsWith('y')) {
    return suffixed(`${base.slice(0, -1)}ieth`, base, 'əθ');
  }
  return suffixed(`${base}th`, base, 'θ');
}

function pluralWord(base) {
  if (base.endsWith('y')) {
    return suffixed(`${base.slice(0, -1)}ies`, base, 'z');
  }
  return suffixed(`${base}s`, base, 'z');
}

function replaceLast(words, transform) {
  return [...words.slice(0, -1), transform(words.at(-1))];
}

function year(value) {
  if (value < 1000 || value > 9999 || (value >= 2000 && value < 2010)) {
    return cardinal(value);
  }
  const high = Math.floor(value / 100);
  const low = value % 100;
  if (low === 0) {
    return [...cardinal(high), 'hundred'];
  }
  return [...cardinal(high), ...(low < 10 ? ['oh'] : []), ...cardinal(low)];
}

const MONTHS =
  'January February March April May June July August September October November December'.split(
    ' '
  );

const MONTH_NAMES = new Set(
  MONTHS.flatMap((month) => [
    month.toLowerCase(),
    month.slice(0, 3).toLowerCase(),
  ])
);

const CURRENCIES = {
  USD: ['dollar', 'dollars', 'cent', 'cents'],
  EUR: ['euro', 'euros', 'cent', 'cents'],
  GBP: ['pound', 'pounds', 'penny', 'pence'],
  JPY: ['yen', 'yen'],
  CNY: ['yuan', 'yuan', 'fen', 'fen'],
  INR: ['rupee', 'rupees', 'paisa', 'paise'],
  RUB: ['ruble', 'rubles', 'kopeck', 'kopecks'],
};

const SCALES = { thousand: 'thousand', million: 'million', billion: 'billion' };

const UNITS = {
  km: ['kilometer', 'kilometers'],
  m: ['meter', 'meters'],
  cm: ['centimeter', 'centimeters'],
  mm: ['millimeter', 'millimeters'],
  kg: ['kilogram', 'kilograms'],
  g: ['gram', 'grams'],
  mg: ['milligram', 'milligrams'],
  l: ['liter', 'liters'],
  ml: ['milliliter', 'milliliters'],
  'km/h': ['kilometer per hour', 'kilometers per hour'],
  mph: ['mile per hour', 'miles per hour'],
  h: ['hour', 'hours'],
  min: ['minute', 'minutes'],
  s: ['second', 'seconds'],
  ms: ['millisecond', 'milliseconds'],
  hz: ['hertz', 'hertz'],
  khz: ['kilohertz', 'kilohertz'],
  mb: ['megabyte', 'megabytes'],
  gb: ['gigabyte', 'gigabytes'],
  '°c': ['degree Celsius', 'degrees Celsius'],
  '°f': ['degree Fahrenheit', 'degrees Fahrenheit'],
  '°': ['degree', 'degrees'],
  '%': ['percent', 'percent'],
};

const SYMBOLS = {
  '&': ['and'],
  '+': ['plus'],
  '=': ['equals'],
  '@': ['at'],
  '#': ['number'],
  '№': ['number'],
  '~': ['about'],
  '×': ['times'],
  '%': ['percent'],
  '°': ['degrees'],
};

const ABBREVIATIONS = {
  'mr.': ['mister'],
  mr: ['mister'],
  'mrs.': ['missus'],
  mrs: ['missus'],
  'ms.': ['miz'],
  'dr.': ['doctor'],
  dr: ['doctor'],
  'prof.': ['professor'],
  'jr.': ['junior'],
  'sr.': ['senior'],
  'vs.': ['versus'],
  vs: ['versus'],
  'etc.': ['et', 'cetera'],
  'e.g.': ['for', 'example'],
  'i.e.': ['that', 'is'],
  'approx.': ['approximately'],
  'ave.': ['avenue'],
  'mt.': ['mount'],
  'inc.': ['incorporated'],
  'ltd.': ['limited'],
  'co.': ['company'],
  'dept.': ['department'],
  'fig.': ['figure'],
  'jan.': ['January'],
  'feb.': ['February'],
  'mar.': ['March'],
  'apr.': ['April'],
  'jun.': ['June'],
  'jul.': ['July'],
  'aug.': ['August'],
  'sep.': ['September'],
  'sept.': ['September'],
  'oct.': ['October'],
  'nov.': ['November'],
  'dec.': ['December'],
};

/** Abbreviations that can end a sentence (the dot then also ends it). */
const SENTENCE_FINAL = new Set(['etc.']);

/** Uppercase words read as words, not spelled out. */
const ACRONYM_WORDS = new Set(
  'NASA NATO UNESCO UNICEF LASER RADAR SCUBA FIFA OPEC AIDS COVID GIF JPEG PIN SIM ASAP'.split(
    ' '
  )
);

/** Two-letter words that stay words when written in capitals. */
const SHOUTED_WORDS = new Set(
  'NO SO GO TO DO WE HE ME BE MY BY UP IS IN ON AT AN AS OF OR IF OH AM'.split(
    ' '
  )
);

const WH_WORDS = new Set(
  'who what where when why which how whom whose'.split(' ')
);

function spell(letters) {
  return [...letters.toLowerCase()]
    .filter((letter) => LETTER_IPA[letter])
    .map((letter) => ({ text: letter, ipa: LETTER_IPA[letter], letter: true }));
}

/** English text normalisation rules. */
export const ENGLISH = {
  lang: 'en',
  decimalComma: false,
  cardinal,
  digits,
  minus: 'minus',
  range: ['to'],
  decimal(integer, fraction) {
    return [...cardinal(integer), 'point', ...digits(fraction)];
  },
  ordinal(value) {
    return replaceLast(cardinal(value), ordinalWord);
  },
  year,
  decade(value) {
    return replaceLast(year(value), pluralWord);
  },
  time(hours, minutes, meridiem) {
    const words = cardinal(hours);
    if (minutes > 0) {
      words.push(...(minutes < 10 ? ['oh'] : []), ...cardinal(minutes));
    } else if (!meridiem) {
      words.push("o'clock");
    }
    return meridiem ? [...words, ...spell(`${meridiem}m`)] : words;
  },
  date({ year: yearValue, month, day }) {
    const words = [MONTHS[month - 1], ...this.ordinal(day)];
    return yearValue ? [...words, ...year(yearValue)] : words;
  },
  /** Numbers are read as years after these words. */
  yearContext: new Set(
    'in since by until till from of during before after around circa year'.split(
      ' '
    )
  ),
  money(number, code, scale) {
    const [one, many, minorOne, minorMany] = CURRENCIES[code] ?? [code, code];
    if (scale) {
      return [...number.words, SCALES[scale], many];
    }
    const { integer, fraction } = number;
    if (fraction.length !== 2 || !minorOne) {
      const single = !fraction && integer === 1;
      return [...number.words, single ? one : many];
    }
    const count = (value, singular, plural) =>
      value > 0 ? [...cardinal(value), value === 1 ? singular : plural] : [];
    const major = count(integer, one, many);
    const minor = count(Number(fraction), minorOne, minorMany);
    if (major.length && minor.length) {
      return [...major, 'and', ...minor];
    }
    return major.length ? major : minor.length ? minor : ['zero', many];
  },
  scaleWord: (scale) => SCALES[scale],
  unit(number, unit) {
    const forms = UNITS[unit.toLowerCase()] ?? UNITS[unit];
    if (!forms) {
      return null;
    }
    const single = !number.fraction && number.integer === 1;
    return [...number.words, ...(single ? forms[0] : forms[1]).split(' ')];
  },
  hasUnit: (unit) => Boolean(UNITS[unit.toLowerCase()]),
  symbol: (char) => SYMBOLS[char] ?? null,
  /** Years after "in 1984", before "BC"; ordinals next to a month name. */
  plain(number, { prev, prev2, next }) {
    const { integer, fraction } = number;
    if (fraction) {
      return number.words;
    }
    const month = (word) => MONTH_NAMES.has(word?.replace(/\.$/, ''));
    const era = ['bc', 'ad', 'ce', 'bce'].includes(next);
    const yearLike = integer >= 1000 && integer <= 2099;
    if (
      (yearLike || era) &&
      (era || this.yearContext.has(prev) || month(prev2) || month(prev))
    ) {
      return year(integer);
    }
    if (integer >= 1 && integer <= 31 && (month(prev) || month(next))) {
      return this.ordinal(integer);
    }
    return number.words;
  },
  abbreviation(token, context = {}) {
    const key = token.toLowerCase();
    if (key === 'no.' || key === 'nos.') {
      return /^\s*\d/.test(context.nextText ?? '') ? ['number'] : null;
    }
    return ABBREVIATIONS[key] ?? null;
  },
  endsSentence: (token) => SENTENCE_FINAL.has(token.toLowerCase()),
  /** Spell an uppercase acronym unless it is read as a word. */
  acronym(token) {
    const latin = /^[A-Z]{2,6}s?$/.test(token);
    if (!latin || ACRONYM_WORDS.has(token) || SHOUTED_WORDS.has(token)) {
      return null;
    }
    const hasVowel = /[AEIOUY]/.test(token);
    const known = englishWordToIpa(token.toLowerCase()).source;
    if (hasVowel && token.length >= 3 && known === 'dictionary') {
      return null;
    }
    const plural = /[A-Z]s$/.test(token);
    const letters = spell(plural ? token.slice(0, -1) : token);
    if (plural) {
      const last = letters.at(-1);
      letters[letters.length - 1] = { ...last, ipa: `${last.ipa}z` };
    }
    return letters;
  },
  spell,
  number: 'number',
  numberSign: /^no\.?$/i,
  isWhWord: (text) => WH_WORDS.has(text.toLowerCase()),
};
