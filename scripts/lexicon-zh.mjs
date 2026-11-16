/**
 * Chinese word data for scripts/build-lexicon.mjs (issue 47).
 *
 * A word of `ZH_PHRASES` stores one payload letter per character: `a` is
 * the first reading of the character in `ZH_READINGS`, `b` the second and
 * so on; an upper-case letter is the same reading in the neutral tone
 * (`朋友 péng you` = `aA`).
 *
 * Words come from data/lexicon/zh-phrases.txt (hand-written, all kept,
 * because they also mark word boundaries) and from character pairs of
 * AISHELL-3 transcripts. AISHELL-3 writes its pinyin after tone sandhi
 * (`你 ni2 好 hao3`) and with tone numbers (5 = neutral), so a 2 written
 * for a third tone, and any tone of 一 and 不, count as that reading.
 */

import { splitTone } from '../src/g2p/pinyin.js';
import { CHARACTER_OVERRIDES } from '../src/g2p/chinese-overrides.js';
import { compareCodePoints } from '../src/g2p/vslex.js';
import { parseAishellLine } from './lexicon-metrics.mjs';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const TONE_FREE = new Set(['一', '不']);

/** The payload letter of reading `index`, upper case when neutral. */
function letterOf(index, neutral) {
  const letter = LETTERS[index];
  return neutral ? letter.toUpperCase() : letter;
}

/**
 * The payload letter of a toned pinyin syllable (`háng`, `you`) among the
 * readings of `char`, or null.
 * @param {string[]} readings
 * @param {string} syllable
 */
export function readingLetter(readings, syllable) {
  const wanted = splitTone(syllable);
  if (!wanted) {
    return null;
  }
  const parsed = readings.map((reading) => splitTone(reading));
  const exact = parsed.findIndex(
    (item) => item?.letters === wanted.letters && item.tone === wanted.tone
  );
  if (exact >= 0) {
    return letterOf(exact, false);
  }
  if (wanted.tone === 5) {
    const same = parsed.findIndex((item) => item?.letters === wanted.letters);
    return same >= 0 ? letterOf(same, true) : null;
  }
  return null;
}

/**
 * Like `readingLetter`, for an AISHELL-3 syllable written after sandhi.
 * @param {string} char
 * @param {string[]} readings
 * @param {string} syllable `hao2`, `de5`
 */
export function aishellLetter(char, readings, syllable) {
  const letter = readingLetter(readings, syllable);
  if (letter) {
    return letter;
  }
  const wanted = splitTone(syllable);
  if (!wanted) {
    return null;
  }
  const index = readings.findIndex((reading) => {
    const item = splitTone(reading);
    return (
      item?.letters === wanted.letters &&
      (TONE_FREE.has(char) || (item.tone === 3 && wanted.tone === 2))
    );
  });
  return index >= 0 ? letterOf(index, false) : null;
}

/** The reading of `char` that the run time uses outside a word. */
export function defaultLetter(char, readings) {
  const override = CHARACTER_OVERRIDES[char];
  return override ? readingLetter(readings, override) : 'a';
}

/**
 * Payloads of the hand-written words of zh-phrases.txt.
 * @param {Map<string, string[]>} words word -> [`pīn yīn`]
 * @param {Map<string, string[]>} readings
 * @returns {Map<string, string>}
 */
export function handPhrases(words, readings) {
  const result = new Map();
  const problems = [];
  for (const [word, [pinyin]] of words) {
    const chars = [...word];
    const syllables = pinyin.split(/\s+/);
    if (chars.length < 2 || chars.length > 4) {
      problems.push(`${word}: words have 2 to 4 characters`);
      continue;
    }
    if (syllables.length !== chars.length) {
      problems.push(
        `${word}: ${syllables.length} syllables for ${chars.length} characters`
      );
      continue;
    }
    const letters = chars.map((char, index) =>
      readings.has(char)
        ? readingLetter(readings.get(char), syllables[index])
        : null
    );
    const bad = letters.findIndex((letter) => !letter);
    if (bad >= 0) {
      const known = readings.get(chars[bad])?.join(' ') ?? 'none';
      problems.push(
        `${word}: ${chars[bad]} ${syllables[bad]} is not a reading (${known})`
      );
      continue;
    }
    result.set(word, letters.join(''));
  }
  if (problems.length > 0) {
    throw new RangeError(`zh-phrases.txt:\n  ${problems.join('\n  ')}`);
  }
  return result;
}

/** Count the payloads of the adjacent character pairs of one line. */
function countLinePairs(pairs, parsed, readings) {
  const letters = parsed.chars.map((char, index) =>
    readings.has(char)
      ? aishellLetter(char, readings.get(char), parsed.pinyin[index])
      : undefined
  );
  for (let index = 0; index + 1 < parsed.chars.length; index++) {
    const [left, right] = [parsed.chars[index], parsed.chars[index + 1]];
    const [a, b] = [letters[index], letters[index + 1]];
    if (a === undefined || b === undefined || left === '儿' || right === '儿') {
      continue;
    }
    const seen = pairs.get(left + right) ?? new Map();
    const payload = a && b ? a + b : '?';
    seen.set(payload, (seen.get(payload) ?? 0) + 1);
    pairs.set(left + right, seen);
  }
}

/** The most frequent payload other than `?`, its count and the total. */
function bestPayload(seen) {
  let total = 0;
  let best = null;
  let bestCount = 0;
  for (const [payload, count] of seen) {
    total += count;
    if (payload !== '?' && count > bestCount) {
      best = payload;
      bestCount = count;
    }
  }
  return { best, bestCount, total };
}

/**
 * Character pairs of AISHELL-3 lines seen at least `minCount` times with
 * one reading in at least `minShare` of them, whose reading is not what
 * the run time reads character by character.
 * @param {string[]} lines content.txt lines used for mining
 * @param {Map<string, string[]>} readings
 * @param {{minCount?: number, minShare?: number}} [options]
 * @returns {Map<string, string>} pair -> payload
 */
export function minePairs(lines, readings, options = {}) {
  const { minCount = 3, minShare = 0.9 } = options;
  const pairs = new Map();
  for (const line of lines) {
    const parsed = parseAishellLine(line);
    if (parsed) {
      countLinePairs(pairs, parsed, readings);
    }
  }
  const mined = new Map();
  const sorted = [...pairs].sort(([a], [b]) => compareCodePoints(a, b));
  for (const [pair, seen] of sorted) {
    const { best, bestCount, total } = bestPayload(seen);
    if (!best || total < minCount || bestCount < minShare * total) {
      continue;
    }
    const [left, right] = [...pair];
    const usual =
      defaultLetter(left, readings.get(left)) +
      defaultLetter(right, readings.get(right));
    if (best !== usual) {
      mined.set(pair, best);
    }
  }
  return mined;
}

/**
 * `ZH_READINGS`: the characters grouped by their list of readings, one
 * `reading,reading=characters` group per distinct list, sorted by code
 * point and cut into strings of at most `width` characters.
 * @param {Map<string, string[]>} readings
 * @param {number} [width]
 */
export function readingGroups(readings, width = 2000) {
  const groups = new Map();
  for (const [char, list] of readings) {
    const key = list.join(',');
    groups.set(key, [...(groups.get(key) ?? []), char]);
  }
  const lines = [];
  let line = '';
  for (const key of [...groups.keys()].sort(compareCodePoints)) {
    const group = `${key}=${groups.get(key).sort(compareCodePoints).join('')}`;
    if (line && line.length + 1 + group.length > width) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line} ${group}` : group;
  }
  if (line) {
    lines.push(line);
  }
  return {
    format: 'zh-readings',
    version: 1,
    count: readings.size,
    groups: lines,
  };
}
