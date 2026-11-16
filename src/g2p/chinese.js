/**
 * Mandarin Chinese grapheme-to-phoneme conversion.
 *
 * Hanzi are converted to pinyin with the generated Unihan reading table,
 * corrected by a small list of frequent polyphonic words (greedy longest
 * match), then tone sandhi is applied per phrase and syllables are rendered
 * as IPA with Chao tone letters. A 儿 after a syllable is the erhua suffix
 * of that syllable (花儿 huār) unless it starts or ends a word in which it
 * is a syllable of its own (儿子, 女儿).
 */

import { CHINESE_READINGS } from './chinese-dict.js';
import {
  applyToneSandhi,
  pinyinSyllableToIpa,
  segmentPinyin,
  splitTone,
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

/** Words that start with a syllabic 儿 ér: 他儿子 is not erhua. */
export const SYLLABIC_ER_BEFORE = new Set([
  '儿子',
  '儿童',
  '儿女',
  '儿孙',
  '儿歌',
  '儿科',
  '儿媳',
  '儿时',
  '儿戏',
]);

/** Words that end with a syllabic 儿 ér: 女儿 is two syllables. */
export const SYLLABIC_ER_AFTER = new Set([
  '女儿',
  '婴儿',
  '幼儿',
  '孤儿',
  '胎儿',
  '少儿',
  '男儿',
  '健儿',
  '宠儿',
  '患儿',
  '妻儿',
  '小儿',
  '混血儿',
  '新生儿',
  '托儿',
]);

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
 * True when the 儿 at `index` is the erhua suffix of the character before
 * it: not the first character, not part of a word of
 * `SYLLABIC_ER_BEFORE` or `SYLLABIC_ER_AFTER`, and the character before it
 * has a known reading other than `er`.
 * @param {string[]} chars
 * @param {number} index
 * @param {{pinyin: string|null}|undefined} previous
 */
function isErhua(chars, index, previous) {
  if (chars[index] !== '儿' || index === 0 || !previous?.pinyin) {
    return false;
  }
  const after = chars.slice(index).join('');
  const before = chars.slice(0, index + 1).join('');
  const syllabic =
    [...SYLLABIC_ER_BEFORE].some((word) => after.startsWith(word)) ||
    [...SYLLABIC_ER_AFTER].some((word) => before.endsWith(word));
  return !syllabic && splitTone(previous.pinyin)?.letters !== 'er';
}

/**
 * Convert a run of Hanzi to toned pinyin syllables.
 * @param {string} text
 * @param {{erhua?: boolean}} [options] erhua false (Taiwan, issue 57): an
 *   erhua 儿 is dropped, it does not r-colour the syllable before it
 *   (一点儿 yī diǎn); a syllabic 儿 (女儿, 婴儿) stays.
 * @returns {{char: string, pinyin: string|null, group: number, erhua?: true}[]}
 *   `group` is the index of the first character of the dictionary phrase
 *   the character belongs to (the character itself when not in a phrase).
 *   An erhua 儿 has no pinyin of its own, the group of the character before
 *   it and `erhua: true`; that character's pinyin gets the `r` (`huār`).
 */
export function hanziToPinyin(text, { erhua = true } = {}) {
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
    const previous = result.at(-1);
    if (!matched && isErhua(chars, index, previous)) {
      if (erhua) {
        previous.pinyin += 'r';
      }
      result.push({
        char: chars[index],
        pinyin: null,
        group: previous.group,
        erhua: true,
      });
      index++;
    } else if (!matched) {
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
function syllablesToIpa(items, { lowThird = false } = {}) {
  const syllables = items.map(parseSyllable).filter(Boolean);
  applyToneSandhi(syllables);
  return syllables.map((syllable, index) =>
    syllableWithTone(syllable, !lowThird && index === syllables.length - 1)
  );
}

/**
 * Pronounce a Chinese word: a run of Hanzi or pinyin syllables.
 * @param {string} word
 * @param {{erhua?: boolean, lowThird?: boolean}} [options] Switches of
 *   regional accents (issue 57): erhua false drops an erhua 儿 (see
 *   hanziToPinyin); lowThird true keeps the third tone low (˨˩) at the end
 *   of a phrase too, as in Taiwan Mandarin.
 * @returns {{ipa: string, pinyin: string, source: 'dictionary'|'pinyin'|'unknown'}}
 */
export function chineseWordToIpa(word, options = {}) {
  const hanzi = [...word].some(isHanzi);
  const items = hanzi
    ? hanziToPinyin(word, options)
    : (segmentPinyin(word) ?? []).map((pinyin) => ({ pinyin }));
  const known = items.filter((item) => item.pinyin);
  return {
    ipa: syllablesToIpa(known, options).join(' '),
    pinyin: known.map((item) => item.pinyin).join(' '),
    source: hanzi ? 'dictionary' : known.length ? 'pinyin' : 'unknown',
  };
}

/**
 * Pronounce a run of Hanzi character by character, with tone sandhi
 * applied across the whole run as in `chineseWordToIpa`.
 * @param {string} text
 * @param {{erhua?: boolean, lowThird?: boolean}} [options] as in chineseWordToIpa.
 * @returns {{char: string, pinyin: string|null, group: number, ipa: string|null}[]}
 */
export function chineseSyllables(text, options = {}) {
  const items = hanziToPinyin(text, options);
  const known = items.filter((item) => parseSyllable(item));
  const ipa = syllablesToIpa(known, options);
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
