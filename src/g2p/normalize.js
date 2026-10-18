/**
 * Text normalisation: turn raw text into speakable words and prosodic
 * breaks before grapheme-to-phoneme conversion.
 *
 * Numbers (grouped, decimal, negative, ranges), ordinals, years, dates,
 * times, money, percentages, units, symbols, abbreviations and acronyms
 * are expanded with the verbaliser of the current language (the language
 * of the last word read). Every output item keeps the source character
 * range it was generated from, so a word highlighted during playback can
 * be mapped back to the input text.
 *
 * Punctuation becomes break symbols that the prosody model reads:
 * `.` statement, `?` question, `!` exclamation, `…` trailing off,
 * `,` continuation, `;` (also `:`) clause, `|` dash, `(`/`)` parenthesis
 * and `"` quotation.
 */

import { CHINESE } from './verbalize-zh.js';
import { ENGLISH } from './verbalize-en.js';
import { HINDI } from './verbalize-hi.js';
import { RUSSIAN } from './verbalize-ru.js';

/** Verbalisers per language. */
export const VERBALIZERS = Object.freeze({
  en: ENGLISH,
  ru: RUSSIAN,
  hi: HINDI,
  zh: CHINESE,
});

const CURRENCY_SYMBOLS = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'CNY',
  '₹': 'INR',
  '₽': 'RUB',
};

const CURRENCY_WORDS = {
  руб: 'RUB',
  'руб.': 'RUB',
  'р.': 'RUB',
  рублей: 'RUB',
  'долл.': 'USD',
  usd: 'USD',
  eur: 'EUR',
  rub: 'RUB',
  gbp: 'GBP',
  inr: 'INR',
  cny: 'CNY',
  jpy: 'JPY',
  रुपये: 'INR',
  元: 'CNY',
};

const SCALE_WORDS = {
  k: 'thousand',
  thousand: 'thousand',
  m: 'million',
  mn: 'million',
  million: 'million',
  b: 'billion',
  bn: 'billion',
  billion: 'billion',
  тыс: 'тыс',
  'тыс.': 'тыс',
  млн: 'млн',
  'млн.': 'млн',
  млрд: 'млрд',
  'млрд.': 'млрд',
};

const PUNCTUATION = [
  [/\.{3,}|…/y, '…'],
  [/[?？][!！?？]*|[!！]+[?？][!！?？]*/y, '?'],
  [/[!！]+/y, '!'],
  [/[.。।॥]/y, '.'],
  [/[,，、]/y, ','],
  [/[;:；：]/y, ';'],
  [/[—–]+|-{2,}|-(?=\s)/y, '|'],
  [/[([{（]/y, '('],
  [/[)\]}）]/y, ')'],
  [/["“”„«»「」『』《》‹›‘’']/y, '"'],
];

/** Separators inside grouped numbers: no-break and thin spaces. */
const GROUP_SPACE = '\\u00a0\\u2009\\u202f';
const SPACE = new RegExp(`[\\s${GROUP_SPACE}]+`, 'y');
const SYMBOL_CHARS = /[&+=@#№~×°%]/y;
const HAN = /\p{Script=Han}+/uy;
const WORD = /(?:\+?[\p{L}\p{M}](?:[\p{L}\p{M}+]|['’](?=[\p{L}\p{M}]))*\d?)+/uy;
const DOTTED_ACRONYM = /(?:\p{Lu}\.){2,}/uy;
const ABBREVIATION = /[\p{L}\p{M}]+\.(?:\s?[\p{L}\p{M}]{1,4}\.)*/uy;
const ISO_DATE = /(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/y;
const DOTTED_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d|\.\d)/y;
const SLASH_DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/y;
const CLOCK_TIME = /(\d{1,2}):(\d{2})(?!\d)(?:\s?([ap])\.?\s?m\b\.?)?/iy;
const HOUR_TIME = /(\d{1,2})\s?([ap])\.?m\b\.?/iy;
const MINUS = /[-−](?=\d)/y;
const RANGE = /[-–—](?=\d)/y;
const NEXT_WORD = /\s*([\p{L}\p{M}]+)/uy;
const UNIT = /\s?(°[CF]?|%|[\p{L}\p{M}]+(?:\/[\p{L}\p{M}]+)?)/uy;
const SCALE =
  /\s?(тыс\.?|млн\.?|млрд\.?|thousand|million|billion|bn|mn|[kKmMbB])(?!\p{L})/uy;
const CURRENCY_AFTER =
  /\s?([$€£¥₹₽元]|руб\.?|р\.|рублей|долл\.|रुपये|usd|eur|rub|gbp|inr|cny|jpy)(?!\p{L})/iuy;
const EN_ORDINAL = /(?:st|nd|rd|th)(?!\p{L})/iuy;
const DECADE = /['’]?s(?!\p{L})/uy;
const SENTENCE_BREAKS = new Set(['.', '!', '?', '…']);

function match(pattern, text, index) {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

function numberPatterns(verbalizer) {
  return [
    ...(verbalizer.decimalComma
      ? []
      : [
          // Indian grouping (12,34,567) and Western grouping (1,234,567).
          /\d{1,2}(?:,\d{2})+,\d{3}(?!\d)/y,
          /\d{1,3}(?:,\d{3})+(?!\d|,\d)/y,
        ]),
    new RegExp(`\\d{1,3}(?:[${GROUP_SPACE}]\\d{3})+(?!\\d)`, 'y'),
    ...(verbalizer.spaceGrouping ? [/\d{1,3}(?: \d{3})+(?!\d)/y] : []),
    /\d+/y,
  ];
}

function numberWords(verbalizer, digits, integer, fraction) {
  if (digits.length > 1 && digits.startsWith('0') && !fraction) {
    return verbalizer.digits(digits);
  }
  return fraction
    ? verbalizer.decimal(integer, fraction)
    : verbalizer.cardinal(integer);
}

/** Parse a number at `index`: grouped thousands and a decimal part. */
function parseNumber(text, index, verbalizer) {
  const found = numberPatterns(verbalizer)
    .map((pattern) => match(pattern, text, index))
    .find(Boolean);
  const digits = found[0].replace(/\D/g, '');
  const decimalPattern = verbalizer.decimalComma ? /[.,](\d+)/y : /\.(\d+)/y;
  const decimal = match(decimalPattern, text, index + found[0].length);
  const fraction = decimal ? decimal[1] : '';
  const end = index + found[0].length + (decimal ? decimal[0].length : 0);
  const integer = Number(digits);
  const words = numberWords(verbalizer, digits, integer, fraction);
  return { text: digits, integer, fraction, words, end };
}

function validDate({ month, day }) {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function fullYear(text) {
  const value = Number(text);
  if (text.length === 4) {
    return value;
  }
  return value < 50 ? 2000 + value : 1900 + value;
}

/** Date formats: pattern and a function returning [year, month, day]. */
const DATE_FORMATS = [
  [ISO_DATE, (found) => [found[1], found[2], found[3]]],
  [DOTTED_DATE, (found) => [found[3], found[2], found[1]]],
  [
    SLASH_DATE,
    (found, lang) =>
      // US order (month/day) for English unless the first part is a day.
      lang === 'en' && Number(found[1]) <= 12
        ? [found[3], found[1], found[2]]
        : [found[3], found[2], found[1]],
  ],
];

function scaleKey(found) {
  return found ? SCALE_WORDS[found[1].toLowerCase()] : undefined;
}

class Normalizer {
  constructor(text, { lang, wordLanguage }) {
    this.text = text;
    this.wordLanguage = wordLanguage;
    this.current = lang;
    this.items = [];
    this.history = [];
    this.token = 0;
    this.index = 0;
  }

  get verbalizer() {
    return VERBALIZERS[this.current] ?? ENGLISH;
  }

  context(end) {
    return {
      prev: this.history.at(-1),
      prev2: this.history.at(-2),
      next: match(NEXT_WORD, this.text, end)?.[1].toLowerCase() ?? '',
      nextText: this.text.slice(end).trimStart(),
    };
  }

  emitWords(words, start, end, lang) {
    for (const word of words) {
      const entry = typeof word === 'string' ? { text: word } : word;
      const say = entry.say ?? entry.text;
      this.items.push({
        kind: 'word',
        ...entry,
        text: entry.text.replace(/\+/g, ''),
        ...(say.includes('+') ? { say } : {}),
        lang: entry.lang ?? lang,
        sourceStart: start,
        sourceEnd: end,
        token: this.token,
      });
    }
    this.token++;
  }

  emitBreak(symbol, start, end) {
    this.items.push({
      kind: 'break',
      symbol,
      sourceStart: start,
      sourceEnd: end,
    });
    if (SENTENCE_BREAKS.has(symbol)) {
      this.history.length = 0;
    }
  }

  /** Emit number words spanning from the current index to `end`. */
  emitNumber(words, end, historyText) {
    this.emitWords(words, this.index, end, this.verbalizer.lang);
    this.history.push(historyText);
    return end;
  }

  run() {
    const rules = [
      this.space,
      this.minus,
      this.date,
      this.time,
      this.currencyFirst,
      this.number,
      this.abbreviation,
      this.word,
      this.punctuation,
      this.symbol,
    ];
    while (this.index < this.text.length) {
      let next = null;
      for (const rule of rules) {
        next = rule.call(this);
        if (next !== null) {
          break;
        }
      }
      // Unknown characters are skipped (one code point).
      const skip = this.text.codePointAt(this.index) > 0xffff ? 2 : 1;
      this.index = next ?? this.index + skip;
    }
    return this.items;
  }

  /** Whitespace and in-word hyphens separate words without a pause. */
  space() {
    const { text, index } = this;
    const found = match(SPACE, text, index);
    if (found) {
      return index + found[0].length;
    }
    const hyphen =
      text[index] === '-' &&
      /[\p{L}\d]/u.test(text[index - 1] ?? '') &&
      /\p{L}/u.test(text[index + 1] ?? '');
    return hyphen ? index + 1 : null;
  }

  minus() {
    const { text, index } = this;
    const leading = index === 0 || /[\s(]/.test(text[index - 1]);
    if (!leading || !match(MINUS, text, index)) {
      return null;
    }
    this.emitWords([this.verbalizer.minus], index, index + 1, this.current);
    return index + 1;
  }

  date() {
    for (const [pattern, parts] of DATE_FORMATS) {
      const found = match(pattern, this.text, this.index);
      if (!found) {
        continue;
      }
      const [year, month, day] = parts(found, this.verbalizer.lang);
      const date = {
        year: fullYear(year),
        month: Number(month),
        day: Number(day),
      };
      if (validDate(date)) {
        const end = this.index + found[0].length;
        const words = this.verbalizer.date(date, this.context(this.index));
        return this.emitNumber(words, end, year);
      }
    }
    return null;
  }

  time() {
    const verbalizer = this.verbalizer;
    const clock = match(CLOCK_TIME, this.text, this.index);
    const hour =
      verbalizer.lang === 'en' ? match(HOUR_TIME, this.text, this.index) : null;
    const found = clock ?? hour;
    if (!found) {
      return null;
    }
    const hours = Number(found[1]);
    const minutes = clock ? Number(clock[2]) : 0;
    const meridiem = (clock ? clock[3] : hour[2])?.toLowerCase();
    const valid = meridiem ? hours >= 1 && hours <= 12 : hours <= 24;
    if (!valid || minutes >= 60) {
      return null;
    }
    const end = this.index + found[0].length;
    const words = verbalizer.time(hours, minutes, meridiem);
    return this.emitNumber(words, end, found[1]);
  }

  /** "$3.50", "€ 20", "£5m". */
  currencyFirst() {
    const code = CURRENCY_SYMBOLS[this.text[this.index]];
    const offset = this.text[this.index + 1] === ' ' ? 2 : 1;
    if (!code || !/\d/.test(this.text[this.index + offset] ?? '')) {
      return null;
    }
    const number = parseNumber(this.text, this.index + offset, this.verbalizer);
    const scale = match(SCALE, this.text, number.end);
    const end = scale ? number.end + scale[0].length : number.end;
    const words = this.verbalizer.money(number, code, scaleKey(scale));
    return this.emitNumber(words, end, number.text);
  }

  number() {
    if (!/\d/.test(this.text[this.index])) {
      return null;
    }
    const number = parseNumber(this.text, this.index, this.verbalizer);
    const readings = [
      this.range,
      this.ordinal,
      this.decade,
      this.money,
      this.unit,
      this.plainNumber,
    ];
    for (const reading of readings) {
      const end = reading.call(this, number);
      if (end !== null) {
        return end;
      }
    }
    return null;
  }

  /** "5-7": English reads "five to seven", Russian pauses in between. */
  range(number) {
    if (!match(RANGE, this.text, number.end)) {
      return null;
    }
    const verbalizer = this.verbalizer;
    this.emitNumber(number.words, number.end, number.text);
    const dash = [number.end, number.end + 1];
    if (verbalizer.range.length) {
      this.emitWords(verbalizer.range, ...dash, verbalizer.lang);
    } else {
      this.emitBreak(',', ...dash);
    }
    return number.end + 1;
  }

  /** "1st", "2-го", "5वाँ". */
  ordinal(number) {
    const verbalizer = this.verbalizer;
    if (number.fraction) {
      return null;
    }
    const found =
      verbalizer.lang === 'en'
        ? match(EN_ORDINAL, this.text, number.end)
        : verbalizer.ordinalSuffix?.exec(this.text.slice(number.end));
    const words =
      found &&
      verbalizer.ordinal(number.integer, found[0], this.context(this.index));
    if (!words) {
      return null;
    }
    return this.emitNumber(words, number.end + found[0].length, number.text);
  }

  /** "the 1990s". */
  decade(number) {
    const verbalizer = this.verbalizer;
    const found =
      verbalizer.decade &&
      !number.fraction &&
      match(DECADE, this.text, number.end);
    if (!found) {
      return null;
    }
    const words = verbalizer.decade(number.integer);
    return this.emitNumber(words, number.end + found[0].length, number.text);
  }

  /** "5 руб.", "3,5 млн ₽", "100 USD". */
  money(number) {
    const scale = match(SCALE, this.text, number.end);
    const start = scale ? number.end + scale[0].length : number.end;
    const found = match(CURRENCY_AFTER, this.text, start);
    const key = found?.[1].toLowerCase();
    const code = found && (CURRENCY_SYMBOLS[key] ?? CURRENCY_WORDS[key]);
    if (!code) {
      return null;
    }
    const words = this.verbalizer.money(number, code, scaleKey(scale));
    return this.emitNumber(words, start + found[0].length, number.text);
  }

  /** "5 km", "20%", "36,6 °C", "5 тыс. человек". */
  unit(number) {
    const found = match(UNIT, this.text, number.end);
    if (!found || !this.isUnit(found, number)) {
      return null;
    }
    let end = number.end + found[0].length;
    // An abbreviation dot inside a sentence ("5 тыс. рублей").
    if (/^\.\s*[\p{Ll}\d]/u.test(this.text.slice(end))) {
      end++;
    }
    const words = this.verbalizer.unit(number, found[1]);
    return words ? this.emitNumber(words, end, number.text) : null;
  }

  isUnit(found, number) {
    if (!this.verbalizer.hasUnit(found[1], number)) {
      return false;
    }
    // "5 m tall", "5 с половиной": a spaced single letter before a word
    // is not a unit.
    const spaced = found[0] !== found[1];
    const after = this.text.slice(number.end + found[0].length);
    return !(spaced && found[1].length === 1 && /^\s+\p{Ll}/u.test(after));
  }

  plainNumber(number) {
    const words =
      this.verbalizer.plain?.(number, this.context(number.end)) ?? number.words;
    return this.emitNumber(words, number.end, number.text);
  }

  /** "Mr.", "e.g.", "т. е.", "U.S.A.". */
  abbreviation() {
    const found = match(ABBREVIATION, this.text, this.index);
    if (!found) {
      return null;
    }
    const lang = this.wordLanguage(found[0]);
    const verbalizer = VERBALIZERS[lang] ?? this.verbalizer;
    const dots = [...found[0].matchAll(/\./g)].map((dot) => dot.index + 1);
    for (const length of dots.reverse()) {
      const key = found[0].slice(0, length).replace(/\s/g, '');
      const end = this.index + length;
      const words = verbalizer.abbreviation(key, this.context(end));
      if (words) {
        this.current = lang;
        return this.emitAbbreviation(verbalizer, key, words, end);
      }
    }
    const acronym = match(DOTTED_ACRONYM, this.text, this.index);
    if (!acronym) {
      return null;
    }
    this.current = lang;
    const end = this.index + acronym[0].length;
    const letters = verbalizer.spell(acronym[0].replace(/\./g, ''));
    this.emitWords(letters, this.index, end, lang);
    return end;
  }

  emitAbbreviation(verbalizer, key, words, end) {
    this.emitWords(words, this.index, end, verbalizer.lang);
    this.history.push(key.toLowerCase());
    // "etc." at the end of a sentence also ends the sentence.
    const final = /^(?:\s*$|\s+\p{Lu})/u.test(this.text.slice(end));
    if (verbalizer.endsSentence(key) && final) {
      this.emitBreak('.', end - 1, end);
    }
    return end;
  }

  word() {
    const found =
      match(HAN, this.text, this.index) ?? match(WORD, this.text, this.index);
    if (!found) {
      return null;
    }
    const word = found[0];
    const end = this.index + word.length;
    this.current = this.wordLanguage(word);
    const verbalizer = this.verbalizer;
    const expanded =
      verbalizer.abbreviation(word, this.context(end)) ??
      (/\d/.test(word) ? null : verbalizer.acronym(word));
    if (expanded) {
      this.emitWords(expanded, this.index, end, this.current);
    } else if (this.current !== 'zh' && /\d$/.test(word)) {
      // Letters followed by a digit (mp3): read the digit as a number.
      const digit = verbalizer.cardinal(Number(word.at(-1)));
      const letters = [word.slice(0, -1), ...digit];
      this.emitWords(letters, this.index, end, this.current);
    } else {
      this.emitWords([word], this.index, end, this.current);
    }
    this.history.push(word.toLowerCase());
    return end;
  }

  punctuation() {
    for (const [pattern, symbol] of PUNCTUATION) {
      const found = match(pattern, this.text, this.index);
      if (found) {
        const end = this.index + found[0].length;
        this.emitBreak(symbol, this.index, end);
        return end;
      }
    }
    return null;
  }

  symbol() {
    const found = match(SYMBOL_CHARS, this.text, this.index);
    const words = found && this.verbalizer.symbol(found[0]);
    if (!words) {
      return null;
    }
    this.emitWords(words, this.index, this.index + 1, this.current);
    return this.index + 1;
  }
}

/**
 * Normalise text into words and breaks.
 * @param {string} text
 * @param {{lang: string, wordLanguage: (word: string) => string}} options
 *   `lang` is the base language; `wordLanguage` tells the language of a
 *   written word (by script).
 * @returns {object[]} items `{kind: 'word', text, say?, ipa?, letter?,
 *   lang, sourceStart, sourceEnd, token}` and `{kind: 'break', symbol,
 *   sourceStart, sourceEnd}`; `say` keeps Russian stress marks (`+`),
 *   and words generated from one source token share `token`.
 */
export function normalizeText(text, options) {
  return new Normalizer(String(text ?? ''), options).run();
}
