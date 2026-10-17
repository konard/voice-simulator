/**
 * Russian verbaliser: cardinals with gender and case agreement of the
 * counted noun, ordinals in all cases, decimals ("две целых пять
 * десятых"), years, dates, times, money, units and abbreviations.
 *
 * Generated words carry `+` before the stressed vowel when the stress
 * dictionary does not know the form; the normaliser strips it from the
 * displayed text and keeps it for pronunciation.
 */

import { russianBelowThousand } from './russian.js';

/** Pick the noun form for a count: [one, few, many]. */
export function ruPlural(value, forms) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return forms[2];
  }
  if (last === 1) {
    return forms[0];
  }
  return last >= 2 && last <= 4 ? forms[1] : forms[2];
}

const SCALES = [
  [1e9, ['милли+ард', 'милли+арда', 'милли+ардов'], 'm'],
  [1e6, ['милли+он', 'милли+она', 'милли+онов'], 'm'],
  [1e3, ['т+ысяча', 'т+ысячи', 'т+ысяч'], 'f'],
];

const DIGITS = 'ноль один два три четыре пять шесть семь восемь девять'.split(
  ' '
);

function belowThousand(value, gender) {
  const words = russianBelowThousand(value, gender === 'f');
  if (gender === 'n' && words.at(-1) === 'один') {
    words[words.length - 1] = 'одн+о';
  }
  return words;
}

/**
 * Spell a non-negative integer (below 10^12) in the nominative case.
 * @param {number} value
 * @param {'m'|'f'|'n'} [gender] gender of the counted noun
 * @returns {string[]}
 */
export function russianCardinal(value, gender = 'm') {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1e12) {
    return [...String(value)].map((digit) => DIGITS[digit] ?? '');
  }
  const words = [];
  let rest = value;
  for (const [scale, forms, scaleGender] of SCALES) {
    const count = Math.floor(rest / scale);
    rest %= scale;
    if (count > 0) {
      // "тысяча", not "одна тысяча", for an exact single thousand.
      words.push(
        ...(count === 1 ? [] : belowThousand(count, scaleGender)),
        ruPlural(count, forms)
      );
    }
  }
  if (rest > 0 || words.length === 0) {
    words.push(...belowThousand(rest, gender));
  }
  return words;
}

/** Genitive combining forms used in "двухтысячный", "пятисотый". */
const GENITIVE_PREFIX = {
  1: '',
  2: 'двух',
  3: 'трёх',
  4: 'четырёх',
  5: 'пяти',
  6: 'шести',
  7: 'семи',
  8: 'восьми',
  9: 'девяти',
  10: 'десяти',
  20: 'двадцати',
  30: 'тридцати',
  40: 'сорока',
  50: 'пятидесяти',
  60: 'шестидесяти',
  70: 'семидесяти',
  80: 'восьмидесяти',
  90: 'девяноста',
  100: 'сто',
  200: 'двухсот',
  300: 'трёхсот',
  400: 'четырёхсот',
  500: 'пятисот',
  600: 'шестисот',
  700: 'семисот',
  800: 'восьмисот',
  900: 'девятисот',
};

function genitivePrefix(value) {
  const hundreds = Math.floor(value / 100) * 100;
  const rest = value % 100;
  const parts = hundreds ? [GENITIVE_PREFIX[hundreds]] : [];
  if (rest >= 11 && rest <= 19) {
    return `${parts.join('')}${TEENS_GENITIVE[rest]}`;
  }
  const tens = Math.floor(rest / 10) * 10;
  if (tens) {
    parts.push(GENITIVE_PREFIX[tens]);
  }
  if (rest % 10) {
    parts.push(
      rest % 10 === 1 && value > 1 ? 'одно' : GENITIVE_PREFIX[rest % 10]
    );
  }
  return parts.join('');
}

const TEENS_GENITIVE = {
  11: 'одиннадцати',
  12: 'двенадцати',
  13: 'тринадцати',
  14: 'четырнадцати',
  15: 'пятнадцати',
  16: 'шестнадцати',
  17: 'семнадцати',
  18: 'восемнадцати',
  19: 'девятнадцати',
};

/** Ordinal stems: [stem, type] with type s (stem stress), e (end stress), soft. */
const ORDINAL_STEMS = {
  0: ['нулев', 'e'],
  1: ['п+ерв', 's'],
  2: ['втор', 'e'],
  3: ['тр+еть', 'soft'],
  4: ['четвёрт', 's'],
  5: ['п+ят', 's'],
  6: ['шест', 'e'],
  7: ['седьм', 'e'],
  8: ['восьм', 'e'],
  9: ['дев+ят', 's'],
  10: ['дес+ят', 's'],
  11: ['од+иннадцат', 's'],
  12: ['двен+адцат', 's'],
  13: ['трин+адцат', 's'],
  14: ['чет+ырнадцат', 's'],
  15: ['пятн+адцат', 's'],
  16: ['шестн+адцат', 's'],
  17: ['семн+адцат', 's'],
  18: ['восемн+адцат', 's'],
  19: ['девятн+адцат', 's'],
  20: ['двадц+ат', 's'],
  30: ['тридц+ат', 's'],
  40: ['сороков', 'e'],
  50: ['пятидес+ят', 's'],
  60: ['шестидес+ят', 's'],
  70: ['семидес+ят', 's'],
  80: ['восьмидес+ят', 's'],
  90: ['девян+ост', 's'],
  100: ['с+от', 's'],
  200: ['двухс+от', 's'],
  300: ['трёхс+от', 's'],
  400: ['четырёхс+от', 's'],
  500: ['пятис+от', 's'],
  600: ['шестис+от', 's'],
  700: ['семис+от', 's'],
  800: ['восьмис+от', 's'],
  900: ['девятис+от', 's'],
};

const HARD_ENDINGS = {
  'm.nom': 'ый',
  'f.nom': 'ая',
  'n.nom': 'ое',
  'pl.nom': 'ые',
  'm.gen': 'ого',
  'm.dat': 'ому',
  'm.ins': 'ым',
  'm.prep': 'ом',
  'f.obl': 'ой',
  'f.acc': 'ую',
  'pl.gen': 'ых',
  'pl.dat': 'ым',
  'pl.ins': 'ыми',
};

const SOFT_ENDINGS = {
  'm.nom': 'ий',
  'f.nom': 'ья',
  'n.nom': 'ье',
  'pl.nom': 'ьи',
  'm.gen': 'ьего',
  'm.dat': 'ьему',
  'm.ins': 'ьим',
  'm.prep': 'ьем',
  'f.obl': 'ьей',
  'f.acc': 'ью',
  'pl.gen': 'ьих',
  'pl.dat': 'ьим',
  'pl.ins': 'ьими',
};

function ordinalWord(stem, type, form) {
  if (type === 'soft') {
    return `${stem.slice(0, -1)}${SOFT_ENDINGS[form]}`;
  }
  if (type === 'e') {
    return `${stem}+${form === 'm.nom' ? 'ой' : HARD_ENDINGS[form]}`;
  }
  return `${stem}${HARD_ENDINGS[form]}`;
}

/**
 * Spell an ordinal number in the given form.
 * @param {number} value
 * @param {string} [form] e.g. 'm.nom', 'n.nom', 'm.gen', 'm.prep'
 * @returns {string[]}
 */
export function russianOrdinal(value, form = 'm.nom') {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1e9) {
    return russianCardinal(value);
  }
  for (const [scale, stem] of [
    [1e6, 'милли+онн'],
    [1e3, 'т+ысячн'],
  ]) {
    if (value >= scale && value % scale === 0) {
      const head = Math.floor(value / scale);
      const big = head >= 1000 ? Math.floor(head / 1000) * 1000 : 0;
      const prefix = genitivePrefix(head - big);
      return [
        ...(big ? russianCardinal(big * scale) : []),
        ordinalWord(`${prefix.replace(/\+/g, '')}${stem}`, 's', form),
      ];
    }
  }
  const rest = value % 100;
  let last = rest;
  if (rest === 0) {
    last = value % 1000;
  } else if (rest >= 20 && rest % 10 !== 0) {
    last = rest % 10;
  }
  const [stem, type] = ORDINAL_STEMS[last];
  return [
    ...(value > last ? russianCardinal(value - last) : []),
    ordinalWord(stem, type, form),
  ];
}

/** Map an ordinal suffix ("-й", "-го", "-м") to a grammatical form. */
const SUFFIX_FORMS = [
  [/^(?:ы?й|ий)$/, 'm.nom'],
  [/^(?:а?я|ья)$/, 'f.nom'],
  [/^(?:о?е|ье)$/, 'n.nom'],
  [/^(?:о|е)?го$/, 'm.gen'],
  [/^(?:о|е)?му$/, 'm.dat'],
  [/^(?:ы|и)?м$/, 'm.ins'],
  [/^(?:о|е)м$/, 'm.prep'],
  [/^(?:ы|и)?х$/, 'pl.gen'],
  [/^(?:у|ь)?ю$/, 'f.acc'],
  [/^(?:ы|и)?ми$/, 'pl.ins'],
  [/^(?:о|е)й$/, 'f.obl'],
];

const PREPOSITIONAL = new Set(['в', 'во', 'на', 'о', 'об', 'обо', 'при']);
const GENITIVE = new Set([
  'до',
  'с',
  'со',
  'от',
  'после',
  'около',
  'из',
  'без',
  'для',
  'у',
]);
const DATIVE = new Set(['к', 'ко', 'по']);

function suffixForm(suffix, prev) {
  const form = SUFFIX_FORMS.find(([pattern]) => pattern.test(suffix))?.[1];
  if (form === 'm.ins' && PREPOSITIONAL.has(prev)) {
    return 'm.prep';
  }
  return form ?? null;
}

const MONTHS = [
  'янв+аря',
  'февр+аля',
  'м+арта',
  'апр+еля',
  'м+ая',
  'и+юня',
  'и+юля',
  '+августа',
  'сентябр+я',
  'октябр+я',
  'ноябр+я',
  'декабр+я',
];

const MONTH_NAMES = new Set(MONTHS.map((month) => month.replace('+', '')));

/** Ordinal form of a year number from the word after it. */
const YEAR_WORDS = {
  год: 'm.nom',
  года: 'm.gen',
  году: 'm.prep',
  годом: 'm.ins',
  годы: 'pl.nom',
  годов: 'pl.gen',
  годах: 'pl.gen',
  гг: 'pl.gen',
  г: 'm.gen',
};

function caseForm(prev, nominative = 'n.nom') {
  if (GENITIVE.has(prev)) {
    return 'm.gen';
  }
  if (DATIVE.has(prev)) {
    return 'm.dat';
  }
  return nominative;
}

/** Words after which a date is named in the nominative ("сегодня 5 мая"). */
const NOMINATIVE_DATE = new Set([
  'сегодня',
  'завтра',
  'вчера',
  'было',
  'будет',
]);

/** A day of the month: genitive ("5 мая я ..."), or by the preposition. */
function dayForm(prev) {
  return NOMINATIVE_DATE.has(prev) ? 'n.nom' : caseForm(prev, 'm.gen');
}

function yearForm(prev, next) {
  const form = YEAR_WORDS[next];
  if (!form) {
    return null;
  }
  if (PREPOSITIONAL.has(prev) && (next === 'г' || next === 'году')) {
    return 'm.prep';
  }
  if (form === 'pl.gen' && PREPOSITIONAL.has(prev)) {
    return 'pl.gen';
  }
  return form;
}

/** Currencies: [major forms, gender, minor forms, minor gender]. */
const CURRENCIES = {
  RUB: [
    ['рубль', 'рубл+я', 'рубл+ей'],
    'm',
    ['коп+ейка', 'коп+ейки', 'коп+еек'],
    'f',
  ],
  USD: [
    ['д+оллар', 'д+оллара', 'д+олларов'],
    'm',
    ['ц+ент', 'ц+ента', 'ц+ентов'],
    'm',
  ],
  EUR: [['+евро', '+евро', '+евро'], 'm', ['ц+ент', 'ц+ента', 'ц+ентов'], 'm'],
  GBP: [
    ['ф+унт', 'ф+унта', 'ф+унтов'],
    'm',
    ['п+енс', 'п+енса', 'п+енсов'],
    'm',
  ],
  JPY: [['+иена', '+иены', '+иен'], 'f'],
  CNY: [['ю+ань', 'ю+аня', 'ю+аней'], 'm'],
  INR: [
    ['р+упия', 'р+упии', 'р+упий'],
    'f',
    ['п+айса', 'п+айсы', 'п+айс'],
    'f',
  ],
};

/** Units: [one, few, many] (the first word inflects) and gender. */
const UNITS = {
  км: [['килом+етр', 'килом+етра', 'килом+етров'], 'm'],
  м: [['м+етр', 'м+етра', 'м+етров'], 'm'],
  см: [['сантим+етр', 'сантим+етра', 'сантим+етров'], 'm'],
  мм: [['миллим+етр', 'миллим+етра', 'миллим+етров'], 'm'],
  кг: [['килогр+амм', 'килогр+амма', 'килогр+аммов'], 'm'],
  г: [['гр+амм', 'гр+амма', 'гр+аммов'], 'm'],
  мг: [['миллигр+амм', 'миллигр+амма', 'миллигр+аммов'], 'm'],
  л: [['л+итр', 'л+итра', 'л+итров'], 'm'],
  мл: [['миллил+итр', 'миллил+итра', 'миллил+итров'], 'm'],
  'км/ч': [
    ['килом+етр в ч+ас', 'килом+етра в ч+ас', 'килом+етров в ч+ас'],
    'm',
  ],
  ч: [['ч+ас', 'ч+аса', 'час+ов'], 'm'],
  мин: [['мин+ута', 'мин+уты', 'мин+ут'], 'f'],
  с: [['сек+унда', 'сек+унды', 'сек+унд'], 'f'],
  сек: [['сек+унда', 'сек+унды', 'сек+унд'], 'f'],
  мс: [['миллисек+унда', 'миллисек+унды', 'миллисек+унд'], 'f'],
  гц: [['г+ерц', 'г+ерца', 'г+ерц'], 'm'],
  кгц: [['килог+ерц', 'килог+ерца', 'килог+ерц'], 'm'],
  мб: [['мегаб+айт', 'мегаб+айта', 'мегаб+айт'], 'm'],
  гб: [['гигаб+айт', 'гигаб+айта', 'гигаб+айт'], 'm'],
  '°c': [['гр+адус ц+ельсия', 'гр+адуса ц+ельсия', 'гр+адусов ц+ельсия'], 'm'],
  '°f': [
    ['гр+адус ф+аренгейта', 'гр+адуса ф+аренгейта', 'гр+адусов ф+аренгейта'],
    'm',
  ],
  '°': [['гр+адус', 'гр+адуса', 'гр+адусов'], 'm'],
  '%': [['проц+ент', 'проц+ента', 'проц+ентов'], 'm'],
  тыс: [['т+ысяча', 'т+ысячи', 'т+ысяч'], 'f'],
  млн: [['милли+он', 'милли+она', 'милли+онов'], 'm'],
  млрд: [['милли+ард', 'милли+арда', 'милли+ардов'], 'm'],
};

const FRACTIONS = [
  null,
  ['дес+ятая', 'дес+ятых', 'дес+ятых'],
  ['с+отая', 'с+отых', 'с+отых'],
  ['т+ысячная', 'т+ысячных', 'т+ысячных'],
];

/** Number words agreeing with a noun of the given gender. */
function countWords(number, gender) {
  if (number.fraction) {
    return decimal(number.integer, number.fraction);
  }
  return russianCardinal(number.integer, gender);
}

/** The noun form after a number: decimals take the genitive singular. */
function countForm(number, forms) {
  return number.fraction ? forms[1] : ruPlural(number.integer, forms);
}

function decimal(integer, fraction) {
  const forms = FRACTIONS[fraction.length];
  if (!forms) {
    return [
      ...russianCardinal(integer),
      'запят+ая',
      ...[...fraction].map((digit) => DIGITS[digit]),
    ];
  }
  const value = Number(fraction);
  return [
    ...russianCardinal(integer, 'f'),
    ruPlural(integer, ['ц+елая', 'ц+елых', 'ц+елых']),
    ...russianCardinal(value, 'f'),
    ruPlural(value, forms),
  ];
}

const SYMBOLS = {
  '&': ['и'],
  '+': ['плюс'],
  '=': ['р+авно'],
  '@': ['соб+ака'],
  '#': ['н+омер'],
  '№': ['н+омер'],
  '~': ['+около'],
  '×': ['умн+ожить', 'на'],
  '%': ['проц+ентов'],
  '°': ['гр+адусов'],
};

const ABBREVIATIONS = {
  'т.е.': ['то', '+есть'],
  'т.д.': ['так', 'д+алее'],
  'т.п.': ['том+у', 'под+обное'],
  'т.к.': ['так', 'как'],
  'др.': ['друг+ие'],
  'см.': ['смотр+и'],
  'напр.': ['наприм+ер'],
  'ул.': ['ул+ица'],
  'д.': ['дом'],
  'кв.': ['кварт+ира'],
  'руб.': ['рубл+ей'],
  'коп.': ['коп+еек'],
  'проф.': ['проф+ессор'],
  'им.': ['+имени'],
  'стр.': ['страниц+а'],
  'рис.': ['рис+унок'],
  'гл.': ['глав+а'],
  'н.э.': ['н+ашей', '+эры'],
  'гг.': ['год+ов'],
};

const SENTENCE_FINAL = new Set(['т.д.', 'т.п.', 'др.', 'н.э.']);

/** Letter names for spelled-out acronyms. */
const LETTERS = {
  а: '+а',
  б: 'б+э',
  в: 'в+э',
  г: 'г+э',
  д: 'д+э',
  е: '+е',
  ё: 'ё',
  ж: 'ж+э',
  з: 'з+э',
  и: '+и',
  й: '+и',
  к: 'к+а',
  л: '+эль',
  м: '+эм',
  н: '+эн',
  о: '+о',
  п: 'п+э',
  р: '+эр',
  с: '+эс',
  т: 'т+э',
  у: '+у',
  ф: '+эф',
  х: 'х+а',
  ц: 'ц+э',
  ч: 'ч+е',
  ш: 'ш+а',
  щ: 'щ+а',
  ы: '+ы',
  э: '+э',
  ю: '+ю',
  я: '+я',
};

const WH_WORDS = new Set(
  'кто что где когда почему как зачем куда откуда сколько какой какая какое какие чей чья чьё чьи отчего'.split(
    ' '
  )
);

function spell(letters) {
  return [...letters.toLowerCase()]
    .filter((letter) => LETTERS[letter])
    .map((letter) => ({ text: letter, say: LETTERS[letter], letter: true }));
}

/** Russian text normalisation rules. */
export const RUSSIAN = {
  lang: 'ru',
  decimalComma: true,
  spaceGrouping: true,
  cardinal: (value) => russianCardinal(value),
  digits: (text) => [...text].map((digit) => DIGITS[digit]),
  minus: 'м+инус',
  range: [],
  decimal,
  ordinalSuffix: /^-(?:[а-яё]{1,3})(?![\p{L}\p{M}])/u,
  ordinal(value, suffix, context) {
    const form = suffix
      ? suffixForm(suffix.replace(/^-/, ''), context.prev)
      : 'm.nom';
    return form ? russianOrdinal(value, form) : null;
  },
  /** Plain numbers: years before "год", days before a month name. */
  plain(number, { prev, next }) {
    if (number.fraction) {
      return number.words;
    }
    const year = yearForm(prev, next);
    if (year && number.integer < 1e5) {
      return russianOrdinal(number.integer, year);
    }
    if (MONTH_NAMES.has(next) && number.integer >= 1 && number.integer <= 31) {
      return russianOrdinal(number.integer, dayForm(prev));
    }
    return number.words;
  },
  time(hours, minutes) {
    if (minutes === 0) {
      return [
        ...russianCardinal(hours),
        ruPlural(hours, ['ч+ас', 'ч+аса', 'час+ов']),
      ];
    }
    return [
      ...russianCardinal(hours),
      ...(minutes < 10 ? ['ноль'] : []),
      ...russianCardinal(minutes, 'f'),
    ];
  },
  date({ year, month, day }, { prev }) {
    const words = [...russianOrdinal(day, dayForm(prev)), MONTHS[month - 1]];
    return year ? [...words, ...russianOrdinal(year, 'm.gen'), 'г+ода'] : words;
  },
  money(number, code, scale) {
    const [forms, gender, minorForms, minorGender] = CURRENCIES[code] ?? [
      [code, code, code],
      'm',
    ];
    if (scale) {
      return [...this.unit(number, scale), forms[2]];
    }
    const { integer, fraction } = number;
    if (fraction && fraction.length === 2 && minorForms) {
      const minor = Number(fraction);
      const words = [
        ...russianCardinal(integer, gender),
        ruPlural(integer, forms),
      ];
      return minor
        ? [
            ...words,
            ...russianCardinal(minor, minorGender),
            ruPlural(minor, minorForms),
          ]
        : words;
    }
    return [...countWords(number, gender), countForm(number, forms)];
  },
  unit(number, unit) {
    const entry = UNITS[unit.toLowerCase()];
    if (!entry) {
      return null;
    }
    const [forms, gender] = entry;
    return [
      ...countWords(number, gender),
      ...countForm(number, forms).split(' '),
    ];
  },
  hasUnit(unit, number) {
    const key = unit.toLowerCase();
    // "2024 г." is a year, not grams.
    if (key === 'г' && number.integer >= 1000 && number.integer <= 2100) {
      return false;
    }
    return Boolean(UNITS[key]);
  },
  symbol: (char) => SYMBOLS[char] ?? null,
  abbreviation(token, { prev }) {
    const key = token.toLowerCase();
    if (key === 'г.') {
      if (/^\d+$/.test(prev ?? '')) {
        return ['г+ода'];
      }
      return ['г+ород'];
    }
    return ABBREVIATIONS[key] ?? null;
  },
  endsSentence: (token) => SENTENCE_FINAL.has(token.toLowerCase()),
  /** Spell acronyms that are not pronounceable as a word (МГУ, США, РФ). */
  acronym(token) {
    if (!/^[А-ЯЁ]{2,6}$/u.test(token)) {
      return null;
    }
    const vowels = token.match(/[АЕЁИОУЫЭЮЯ]/gu)?.length ?? 0;
    const consonantStart = /^[^АЕЁИОУЫЭЮЯ]{2}/u.test(token);
    if (vowels === 0 || token.length === 2 || consonantStart) {
      return spell(token);
    }
    return null;
  },
  spell,
  numberSign: /^(?:№|номер)$/iu,
  isWhWord: (text) => WH_WORDS.has(text.toLowerCase()),
};
