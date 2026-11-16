/**
 * The readings of Chinese characters (issue 47), shared by `chinese.js`
 * and `lexicon.js`.
 *
 * `ZH_READINGS` (src/g2p/lexicon/zh.js) lists every reading of the 8105
 * characters of the Table of General Standard Chinese Characters, Unihan
 * kMandarin first. Outside a word a character is read with its first
 * reading or with `CHARACTER_OVERRIDES`. A word of `ZH_PHRASES` stores one
 * payload letter per character: `a` the first reading, `b` the second, and
 * upper case the same reading in the neutral tone.
 */

import { ZH_READINGS } from './lexicon/zh.js';
import { CHARACTER_OVERRIDES } from './chinese-overrides.js';
import { splitTone } from './pinyin.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

let readings = null;

/**
 * Every reading of each character, decoded on first use.
 * @returns {Map<string, string[]>}
 */
export function characterReadings() {
  if (!readings) {
    readings = new Map();
    for (const line of ZH_READINGS.groups) {
      for (const group of line.split(' ')) {
        const split = group.indexOf('=');
        const list = group.slice(0, split).split(',');
        for (const char of group.slice(split + 1)) {
          readings.set(char, list);
        }
      }
    }
  }
  return readings;
}

/**
 * The reading of a character outside a word, or null.
 * @param {string} char
 */
export function defaultReading(char) {
  return (
    CHARACTER_OVERRIDES[char] ?? characterReadings().get(char)?.[0] ?? null
  );
}

/** The toneless form of a toned syllable (`yǒu` -> `you`): the neutral tone. */
function neutral(syllable) {
  return splitTone(syllable)?.letters ?? syllable;
}

/**
 * The pinyin syllables of a word from its payload, or null when a letter
 * names no reading of its character.
 * @param {string} word
 * @param {string} payload one letter per character
 * @returns {string[]|null}
 */
export function payloadToPinyin(word, payload) {
  const chars = [...word];
  if (chars.length !== payload.length) {
    return null;
  }
  const syllables = chars.map((char, index) => {
    const letter = payload[index];
    const reading =
      characterReadings().get(char)?.[LETTERS.indexOf(letter.toLowerCase())];
    if (!reading) {
      return null;
    }
    return letter === letter.toLowerCase() ? reading : neutral(reading);
  });
  return syllables.includes(null) ? null : syllables;
}
