/**
 * Mandarin verbaliser: numbers as Chinese numerals (两 before measure
 * words, digit-by-digit years), decimals with 点, ordinals with 第,
 * dates (年月日), times (点/分), money, percent (百分之) and units.
 */

import { chineseNumber } from './chinese.js';

const DIGITS = '零一二三四五六七八九';

/** Measure words and nouns after which 2 is read 两. */
const MEASURE = /^[个点位本只条张件次天年岁人辆杯份块种家双台座首门]/u;

function cardinal(value) {
  return [chineseNumber(value)];
}

function digits(text) {
  return [[...text].map((digit) => DIGITS[digit]).join('')];
}

function decimal(integer, fraction) {
  return [`${chineseNumber(integer)}点${digits(fraction)[0]}`];
}

const CURRENCIES = {
  CNY: '元',
  USD: '美元',
  EUR: '欧元',
  GBP: '英镑',
  JPY: '日元',
  INR: '卢比',
  RUB: '卢布',
};

const UNITS = {
  km: '公里',
  m: '米',
  cm: '厘米',
  mm: '毫米',
  kg: '公斤',
  g: '克',
  l: '升',
  ml: '毫升',
  'km/h': '公里每小时',
  h: '小时',
  min: '分钟',
  s: '秒',
  hz: '赫兹',
  '°c': '摄氏度',
  '°f': '华氏度',
  '°': '度',
};

const SCALES = { k: '千', w: '万', 万: '万', 亿: '亿', m: '百万', bn: '十亿' };

const SYMBOLS = {
  '&': ['和'],
  '+': ['加'],
  '=': ['等于'],
  '@': ['艾特'],
  '#': ['号'],
  '№': ['号'],
  '~': ['约'],
  '×': ['乘'],
  '%': ['百分之'],
  '°': ['度'],
};

function numberText(number) {
  return number.fraction
    ? decimal(number.integer, number.fraction)[0]
    : chineseNumber(number.integer);
}

/** Mandarin text normalisation rules. */
export const CHINESE = {
  lang: 'zh',
  decimalComma: false,
  cardinal,
  digits,
  minus: '负',
  range: ['到'],
  decimal,
  ordinal: (value) => [`第${chineseNumber(value)}`],
  plain(number, { nextText }) {
    if (number.fraction) {
      return number.words;
    }
    if (/^年/u.test(nextText) && number.text.length >= 3) {
      return digits(number.text);
    }
    if (number.integer === 2 && MEASURE.test(nextText)) {
      return ['两'];
    }
    return number.words;
  },
  time(hours, minutes) {
    const hour = hours === 2 ? '两' : chineseNumber(hours);
    if (minutes === 0) {
      return [`${hour}点`];
    }
    const minute = `${minutes < 10 ? '零' : ''}${chineseNumber(minutes)}`;
    return [`${hour}点${minute}分`];
  },
  date({ year, month, day }) {
    const yearText = year ? `${digits(String(year))[0]}年` : '';
    return [`${yearText}${chineseNumber(month)}月${chineseNumber(day)}日`];
  },
  money(number, code, scale) {
    const scaleText = scale ? (SCALES[scale.toLowerCase()] ?? '') : '';
    return [`${numberText(number)}${scaleText}${CURRENCIES[code] ?? ''}`];
  },
  unit(number, unit) {
    if (unit === '%') {
      return [`百分之${numberText(number)}`];
    }
    const name = UNITS[unit.toLowerCase()] ?? SCALES[unit.toLowerCase()];
    return name ? [`${numberText(number)}${name}`] : null;
  },
  hasUnit: (unit) => unit === '%' || Boolean(UNITS[unit.toLowerCase()]),
  symbol: (char) => SYMBOLS[char] ?? null,
  abbreviation: () => null,
  endsSentence: () => false,
  acronym: () => null,
  spell: () => [],
  isWhWord: () => false,
};
