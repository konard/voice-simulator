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
import { soundIpa } from '../ipa/parse.js';

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
// The `d` flag gives the offsets of the groups: the parts of the token
// (day, hour, ...) that the spoken words read.
const ISO_DATE = /(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/dy;
const DOTTED_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d|\.\d)/dy;
const SLASH_DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/dy;
const CLOCK_TIME = /(\d{1,2}):(\d{2})(?!\d)(?:\s?(([ap])\.?\s?m\b\.?))?/diy;
const HOUR_TIME = /(\d{1,2})\s?(([ap])\.?m\b\.?)/diy;
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

/** Seconds of laughter per written syllable (`hahaha`: 0.6 s). */
const LAUGH_SYLLABLE_SECONDS = 0.2;
const HAN_CHAR = /\p{Script=Han}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const HYPHENATED_WORD = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/uy;
const ELLIPSIS = /…|\.\.\./y;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Laughter of each verbaliser: two or more of its laugh syllables in a
 * row, with or without hyphens, not followed by a letter (Hanzi: any).
 */
const LAUGHTER = Object.values(VERBALIZERS).map((verbalizer) => {
  const syllables = verbalizer.fillerWords.laugh;
  const one = `(?:${syllables.map(escapeRegExp).join('|')})`;
  const han = syllables.every((syllable) => HAN_CHAR.test(syllable));
  const tail = han ? '' : '(?![\\p{L}\\p{M}])';
  return {
    lang: verbalizer.lang,
    pattern: new RegExp(`${one}(?:-?${one})+${tail}`, 'iuy'),
    syllable: new RegExp(one, 'giu'),
  };
});

/**
 * The sound (`filler` or `um`) of a written word in `fillers` (the
 * `FILLER_WORDS` of a verbaliser), or null. A repeated form (`э-э-э`)
 * is its part; `ellipsis` tells whether `…` follows (Hindi `अ…`).
 */
function fillerName(fillers, word, ellipsis) {
  const parts = word.split('-');
  const forms = parts.every((part) => part === parts[0])
    ? [word, parts[0]]
    : [word];
  for (const name of ['filler', 'um']) {
    const spellings = fillers[name];
    if (
      forms.some(
        (form) =>
          spellings.includes(form) ||
          (ellipsis && spellings.includes(`${form}…`))
      )
    ) {
      return name;
    }
  }
  return null;
}

/** Written laughter at `index`: `{text, name, seconds, lang}` or null. */
function writtenLaughter(text, index) {
  for (const { lang, pattern, syllable } of LAUGHTER) {
    const found = match(pattern, text, index);
    if (found) {
      const count = found[0].match(syllable).length;
      return {
        text: found[0],
        name: 'laugh',
        seconds: count * LAUGH_SYLLABLE_SECONDS,
        lang,
      };
    }
  }
  return null;
}

/**
 * A written hesitation or laughter at `index` (issue 56): `{text, name,
 * seconds?, lang}`, or null. A Hanzi is read alone (嗯 in 嗯好); other
 * scripts need a whole word. The ellipsis of a spelling such as `अ…`
 * stays in the text as a break.
 */
function writtenSound(text, index, wordLanguage) {
  const char = String.fromCodePoint(text.codePointAt(index));
  const han = HAN_CHAR.test(char);
  if (!han && LETTER_OR_MARK.test(text[index - 1] ?? '')) {
    return null;
  }
  const laughter = writtenLaughter(text, index);
  if (laughter) {
    return laughter;
  }
  const word = han ? char : match(HYPHENATED_WORD, text, index)?.[0];
  if (!word) {
    return null;
  }
  const lang = wordLanguage(word);
  const fillers = VERBALIZERS[lang]?.fillerWords;
  const ellipsis = Boolean(match(ELLIPSIS, text, index + word.length));
  const name = fillers && fillerName(fillers, word.toLowerCase(), ellipsis);
  return name ? { text: word, name, lang } : null;
}

/**
 * Where a run of Hanzi is cut before a written sound (嗯, 呃, 哈哈) that
 * does not start it: its index, or the length of the run.
 */
function hanSoundCut(run) {
  for (let index = 1; index < run.length; index++) {
    if (writtenSound(run, index, () => 'zh')) {
      return index;
    }
  }
  return run.length;
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
  const integerEnd = index + found[0].length;
  return {
    text: digits,
    integer,
    fraction,
    words,
    start: index,
    integerEnd,
    end,
  };
}

/**
 * Source ranges of the parts of a number: the whole `amount`, its
 * integer (`major`) and its fraction (`minor`, as cents).
 */
function numberRanges(number) {
  return {
    amount: [number.start, number.end],
    major: [number.start, number.integerEnd],
    minor: number.fraction ? [number.integerEnd + 1, number.end] : undefined,
  };
}

/** Range of the last group of a match, as `[start, end]` offsets. */
function tailRange(found, start) {
  const end = start + found[0].length;
  return [end - found[1].length, end];
}

/**
 * Words of a verbaliser result. A flat list has no parts; an object
 * names its parts and lists them in spoken `order` (`{order: ['month',
 * 'day', 'year'], month: [...], ...}`), and every word of a part with a
 * known source range gets `partStart` and `partEnd`.
 * @param {string[]|object[]|{order: string[]}} result
 * @param {Object<string, number[]|undefined>} ranges
 */
function partWords(result, ranges) {
  if (Array.isArray(result)) {
    return result;
  }
  return result.order.flatMap((name) =>
    (result[name] ?? []).map((word) => {
      const entry = typeof word === 'string' ? { text: word } : word;
      const range = ranges[name];
      return range
        ? { ...entry, partStart: range[0], partEnd: range[1] }
        : entry;
    })
  );
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

/**
 * Date formats: pattern and a function returning the groups of the year,
 * the month and the day.
 */
const DATE_FORMATS = [
  [ISO_DATE, () => [1, 2, 3]],
  [DOTTED_DATE, () => [3, 2, 1]],
  [
    SLASH_DATE,
    (found, lang) =>
      // US order (month/day) for English unless the first part is a day.
      lang === 'en' && Number(found[1]) <= 12 ? [3, 1, 2] : [3, 2, 1],
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

  /** Emit a verbaliser result whose parts read the given ranges. */
  emitParts(result, ranges, end, historyText) {
    return this.emitNumber(partWords(result, ranges), end, historyText);
  }

  run() {
    const rules = [
      this.space,
      this.minus,
      this.date,
      this.time,
      this.currencyFirst,
      this.number,
      this.sound,
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
      const groups = parts(found, this.verbalizer.lang);
      const [year, month, day] = groups.map((group) => found[group]);
      const date = {
        year: fullYear(year),
        month: Number(month),
        day: Number(day),
      };
      if (validDate(date)) {
        const end = this.index + found[0].length;
        const words = this.verbalizer.date(date, this.context(this.index));
        const [yearRange, monthRange, dayRange] = groups.map(
          (group) => found.indices[group]
        );
        const ranges = { year: yearRange, month: monthRange, day: dayRange };
        return this.emitParts(words, ranges, end, year);
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
    const meridiem = (clock ? clock[4] : hour[3])?.toLowerCase();
    const valid = meridiem ? hours >= 1 && hours <= 12 : hours <= 24;
    if (!valid || minutes >= 60) {
      return null;
    }
    const end = this.index + found[0].length;
    const words = verbalizer.time(hours, minutes, meridiem);
    const ranges = {
      hour: found.indices[1],
      minute: clock ? clock.indices[2] : undefined,
      period: clock ? clock.indices[3] : hour.indices[2],
    };
    return this.emitParts(words, ranges, end, found[1]);
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
    const ranges = {
      ...numberRanges(number),
      scale: scale ? tailRange(scale, number.end) : undefined,
      currency: [this.index, this.index + 1],
    };
    return this.emitParts(words, ranges, end, number.text);
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
    const ranges = {
      ...numberRanges(number),
      scale: scale ? tailRange(scale, number.end) : undefined,
      currency: tailRange(found, start),
    };
    return this.emitParts(words, ranges, start + found[0].length, number.text);
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
    if (!words) {
      return null;
    }
    const ranges = {
      amount: [number.start, number.end],
      unit: [tailRange(found, number.end)[0], end],
    };
    return this.emitParts(words, ranges, end, number.text);
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

  /**
   * A written hesitation (`um`, `э-э`, `嗯`) or laughter (`hahaha`,
   * `ха-ха`, `哈哈`): a word whose IPA is the sound (`⸨um⸩`,
   * `⸨laugh:0.6⸩`, LAUGH_SYLLABLE_SECONDS per syllable), see FILLER_WORDS
   * of the verbalisers.
   */
  sound() {
    const found = writtenSound(this.text, this.index, this.wordLanguage);
    if (!found) {
      return null;
    }
    const end = this.index + found.text.length;
    this.current = found.lang;
    const ipa = soundIpa(found.name, found.seconds);
    const entry = { text: found.text, ipa, sound: found.name };
    this.emitWords([entry], this.index, end, found.lang);
    this.history.push(found.text.toLowerCase());
    return end;
  }

  word() {
    const han = match(HAN, this.text, this.index);
    const found = han ?? match(WORD, this.text, this.index);
    if (!found) {
      return null;
    }
    const word = han ? han[0].slice(0, hanSoundCut(han[0])) : found[0];
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
 *   lang, sourceStart, sourceEnd, partStart?, partEnd?, token}` and
 *   `{kind: 'break', symbol, sourceStart, sourceEnd}`; `say` keeps
 *   Russian stress marks (`+`), words generated from one source token
 *   share `token`, and `partStart`/`partEnd` give the part of the token
 *   that a word reads (the day of a date, the currency of a sum).
 */
export function normalizeText(text, options) {
  return new Normalizer(String(text ?? ''), options).run();
}
