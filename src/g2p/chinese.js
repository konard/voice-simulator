/**
 * Mandarin Chinese grapheme-to-phoneme conversion.
 *
 * Hanzi are converted to pinyin with the generated Unihan reading table,
 * corrected by a small list of frequent polyphonic words (greedy longest
 * match), then tone sandhi is applied per phrase and syllables are rendered
 * as IPA with Chao tone letters.
 */

import { CHINESE_READINGS } from './chinese-dict.js';
import {
  applyToneSandhi,
  pinyinSyllableToIpa,
  segmentPinyin,
  syllableWithTone,
} from './pinyin.js';

/** Characters whose most frequent reading differs from Unihan kMandarin. */
const CHARACTER_OVERRIDES = {
  长: 'cháng',
  还: 'hái',
  都: 'dōu',
  着: 'zhe',
  得: 'de',
  地: 'dì',
  和: 'hé',
  只: 'zhǐ',
  了: 'le',
  么: 'me',
  们: 'men',
  个: 'gè',
  子: 'zǐ',
  的: 'de',
  吗: 'ma',
  呢: 'ne',
  吧: 'ba',
  啊: 'a',
};

/** Frequent words with context-dependent readings (space separated). */
const PHRASES = {
  银行: 'yín háng',
  行业: 'háng yè',
  长大: 'zhǎng dà',
  校长: 'xiào zhǎng',
  还是: 'hái shì',
  觉得: 'jué de',
  音乐: 'yīn yuè',
  快乐: 'kuài lè',
  睡觉: 'shuì jiào',
  了解: 'liǎo jiě',
  为了: 'wèi le',
  因为: 'yīn wèi',
  地方: 'dì fang',
  东西: 'dōng xi',
  朋友: 'péng you',
  谢谢: 'xiè xie',
  先生: 'xiān sheng',
  时候: 'shí hou',
  孩子: 'hái zi',
  桌子: 'zhuō zi',
  妈妈: 'mā ma',
  爸爸: 'bà ba',
  哥哥: 'gē ge',
  姐姐: 'jiě jie',
  弟弟: 'dì di',
  妹妹: 'mèi mei',
  什么: 'shén me',
  怎么: 'zěn me',
  这么: 'zhè me',
  那么: 'nà me',
  多少: 'duō shao',
  知道: 'zhī dao',
  意思: 'yì si',
  一样: 'yí yàng',
  重要: 'zhòng yào',
  重新: 'chóng xīn',
  中国: 'zhōng guó',
  声音: 'shēng yīn',
  说话: 'shuō huà',
  模型: 'mó xíng',
  头发: 'tóu fa',
  发现: 'fā xiàn',
  会计: 'kuài jì',
  数学: 'shù xué',
  学生: 'xué sheng',
  便宜: 'pián yi',
  方便: 'fāng biàn',
  处理: 'chǔ lǐ',
  空气: 'kōng qì',
};

const MAX_PHRASE = Math.max(...Object.keys(PHRASES).map((key) => key.length));

let readings = null;

function getReadings() {
  if (!readings) {
    readings = new Map();
    for (const group of CHINESE_READINGS.split(' ')) {
      const [syllable, chars] = group.split('=');
      for (const char of chars) {
        readings.set(char, syllable);
      }
    }
    for (const [char, syllable] of Object.entries(CHARACTER_OVERRIDES)) {
      readings.set(char, syllable);
    }
  }
  return readings;
}

/** True for CJK unified ideographs (basic block and extension A). */
export function isHanzi(char) {
  return /[㐀-䶿一-鿿]/u.test(char);
}

/**
 * Convert a run of Hanzi to toned pinyin syllables.
 * @param {string} text
 * @returns {{char: string, pinyin: string|null, group: number}[]}
 *   `group` is the index of the first character of the dictionary phrase
 *   the character belongs to (the character itself when not in a phrase).
 */
export function hanziToPinyin(text) {
  const chars = [...text];
  const result = [];
  let index = 0;
  while (index < chars.length) {
    let matched = false;
    for (
      let length = Math.min(MAX_PHRASE, chars.length - index);
      length > 1;
      length--
    ) {
      const phrase = chars.slice(index, index + length).join('');
      if (PHRASES[phrase]) {
        const group = index;
        PHRASES[phrase]
          .split(' ')
          .forEach((pinyin, offset) =>
            result.push({ char: chars[index + offset], pinyin, group })
          );
        index += length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push({
        char: chars[index],
        pinyin: getReadings().get(chars[index]) ?? null,
        group: index,
      });
      index++;
    }
  }
  return result;
}

function parseSyllable({ char, pinyin }) {
  const parsed = pinyin ? pinyinSyllableToIpa(pinyin) : null;
  return parsed ? { ...parsed, char, pinyin } : null;
}

/**
 * Convert syllables (with optional source characters) to an IPA phrase.
 * @param {{char?: string, pinyin: string|null}[]} items
 */
function syllablesToIpa(items) {
  const syllables = items.map(parseSyllable).filter(Boolean);
  applyToneSandhi(syllables);
  return syllables.map((syllable, index) =>
    syllableWithTone(syllable, index === syllables.length - 1)
  );
}

/**
 * Pronounce a Chinese word: a run of Hanzi or pinyin syllables.
 * @param {string} word
 * @returns {{ipa: string, pinyin: string, source: 'dictionary'|'pinyin'|'unknown'}}
 */
export function chineseWordToIpa(word) {
  const hanzi = [...word].some(isHanzi);
  const items = hanzi
    ? hanziToPinyin(word)
    : (segmentPinyin(word) ?? []).map((pinyin) => ({ pinyin }));
  const known = items.filter((item) => item.pinyin);
  return {
    ipa: syllablesToIpa(known).join(' '),
    pinyin: known.map((item) => item.pinyin).join(' '),
    source: hanzi ? 'dictionary' : known.length ? 'pinyin' : 'unknown',
  };
}

/**
 * Pronounce a run of Hanzi character by character, with tone sandhi
 * applied across the whole run as in `chineseWordToIpa`.
 * @param {string} text
 * @returns {{char: string, pinyin: string|null, group: number, ipa: string|null}[]}
 */
export function chineseSyllables(text) {
  const items = hanziToPinyin(text);
  const known = items.filter((item) => parseSyllable(item));
  const ipa = syllablesToIpa(known);
  const byItem = new Map(known.map((item, index) => [item, ipa[index]]));
  return items.map((item) => ({ ...item, ipa: byItem.get(item) ?? null }));
}

/** True when the Latin text is valid pinyin (tone marks or numbers). */
export function isPinyin(text) {
  return segmentPinyin(text) !== null;
}

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千'];

function belowTenThousand(value) {
  let text = '';
  let zero = false;
  for (let unit = 3; unit >= 0; unit--) {
    const digit = Math.floor(value / 10 ** unit) % 10;
    if (digit === 0) {
      zero = text !== '';
      continue;
    }
    text += `${zero ? '零' : ''}${DIGITS[digit]}${UNITS[unit]}`;
    zero = false;
  }
  return text.replace(/^一十/, '十');
}

/**
 * Write a non-negative integer with Chinese numerals (up to 10^12).
 * @param {number} value
 * @returns {string}
 */
export function chineseNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1e12) {
    return [...String(value)].map((digit) => DIGITS[digit] ?? '').join('');
  }
  if (value === 0) {
    return '零';
  }
  const groups = [
    [1e8, '亿'],
    [1e4, '万'],
    [1, ''],
  ];
  let text = '';
  let rest = value;
  for (const [scale, name] of groups) {
    const part = Math.floor(rest / scale);
    rest %= scale;
    if (part > 0) {
      const needsZero = text !== '' && part < 1000;
      text += `${needsZero ? '零' : ''}${belowTenThousand(part)}${name}`;
    }
  }
  return text;
}
