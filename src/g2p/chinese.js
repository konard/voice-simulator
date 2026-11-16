/**
 * Mandarin Chinese grapheme-to-phoneme conversion.
 *
 * Hanzi are converted to pinyin word by word (greedy longest match over
 * the user lexicons and `ZH_PHRASES`, see `lexicon.js`), other characters
 * with their usual reading (`chinese-readings.js`), then tone sandhi is applied per phrase and syllables are rendered
 * as IPA with Chao tone letters. A 儿 after a syllable is the erhua suffix
 * of that syllable (花儿 huār) unless it starts or ends a word in which it
 * is a syllable of its own (儿子, 女儿).
 */

import {
  applyToneSandhi,
  pinyinSyllableToIpa,
  segmentPinyin,
  splitTone,
  syllableWithTone,
} from './pinyin.js';
import { defaultReading, payloadToPinyin } from './chinese-readings.js';
import {
  lexiconFor,
  longestUserWord,
  registerShippedSpeaker,
  userPronunciation,
} from './lexicon.js';

/** The longest word of `ZH_PHRASES`, in characters. */
const MAX_PHRASE = 4;

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
 * @returns {{char: string, pinyin: string|null, group: number, erhua?: true}[]}
 *   `group` is the index of the first character of the dictionary phrase
 *   the character belongs to (the character itself when not in a phrase).
 *   An erhua 儿 has no pinyin of its own, the group of the character before
 *   it and `erhua: true`; that character's pinyin gets the `r` (`huār`).
 */
export function hanziToPinyin(text) {
  const chars = [...text];
  const longest = Math.max(MAX_PHRASE, longestUserWord('zh'));
  const result = [];
  let index = 0;
  while (index < chars.length) {
    const word = matchWord(chars, index, longest);
    const previous = result.at(-1);
    if (word) {
      word.syllables.forEach((pinyin, offset) =>
        result.push({
          char: chars[index + offset],
          pinyin,
          group: index,
          ...(word.user ? { user: true } : {}),
        })
      );
      index += word.syllables.length;
    } else if (isErhua(chars, index, previous)) {
      previous.pinyin += 'r';
      result.push({
        char: chars[index],
        pinyin: null,
        group: previous.group,
        erhua: true,
      });
      index++;
    } else {
      result.push({
        char: chars[index],
        pinyin: defaultReading(chars[index]),
        group: index,
      });
      index++;
    }
  }
  return result;
}

/**
 * The longest word starting at `index`: a user word (of any length) or a
 * word of `ZH_PHRASES` (2 to 4 characters), or null.
 * @returns {{syllables: string[], user: boolean}|null}
 */
function matchWord(chars, index, longest) {
  for (
    let length = Math.min(longest, chars.length - index);
    length > 0;
    length--
  ) {
    const word = chars.slice(index, index + length).join('');
    const user = userPronunciation('zh', word);
    if (user) {
      return { syllables: user.trim().split(/\s+/), user: true };
    }
    const payload =
      length > 1 && length <= MAX_PHRASE
        ? lexiconFor('zh', 'phrases').lookup(word)?.[0]
        : null;
    const syllables = payload ? payloadToPinyin(word, payload) : null;
    if (syllables) {
      return { syllables, user: false };
    }
  }
  return null;
}

function parseSyllable({ char, pinyin, user }) {
  const parsed = pinyin ? pinyinSyllableToIpa(pinyin) : null;
  return parsed ? { ...parsed, char, pinyin, ...(user ? { user } : {}) } : null;
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
 * @returns {{ipa: string, pinyin: string,
 *   source: 'user'|'dictionary'|'pinyin'|'unknown'}}
 *   `user` when a user lexicon gave the reading of a character.
 */
export function chineseWordToIpa(word) {
  const hanzi = [...word].some(isHanzi);
  const items = hanzi
    ? hanziToPinyin(word)
    : (segmentPinyin(word) ?? []).map((pinyin) => ({ pinyin }));
  const known = items.filter((item) => item.pinyin);
  let source = known.length ? 'pinyin' : 'unknown';
  if (hanzi) {
    source = items.some((item) => item.user) ? 'user' : 'dictionary';
  }
  return {
    ipa: syllablesToIpa(known).join(' '),
    pinyin: known.map((item) => item.pinyin).join(' '),
    source,
  };
}

/**
 * IPA of a word read with the given pinyin syllables (sandhi applied).
 * @param {string} word
 * @param {string} pinyin space-separated syllables, one per character
 */
function wordWithPinyin(word, pinyin) {
  const chars = [...word];
  const items = pinyin
    .trim()
    .split(/\s+/)
    .map((syllable, index) => ({ char: chars[index], pinyin: syllable }));
  return syllablesToIpa(items).join(' ');
}

registerShippedSpeaker('zh', (word, pinyin) => {
  if (pinyin) {
    return wordWithPinyin(word, pinyin);
  }
  const payload = lexiconFor('zh', 'phrases').lookup(word)?.[0];
  const syllables = payload ? payloadToPinyin(word, payload) : null;
  return syllables ? wordWithPinyin(word, syllables.join(' ')) : null;
});

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
