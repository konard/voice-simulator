/**
 * Measurements of the pronunciation lexicons (issue 47), shared by
 * `scripts/build-lexicon.mjs coverage`, the heavy test
 * tests/heavy/lexicon-coverage.test.js and experiments/issue-47-measure.mjs.
 *
 * - `coverage(lang, lines)`: the share of running words whose `source` is
 *   not `rules` (they come from a lexicon, the morphology or the text
 *   normaliser) and the most frequent words read by the letter rules.
 * - `aishellAccuracy(lines)`: the share of the syllables of AISHELL-3
 *   transcript lines that `hanziToPinyin` reads as the transcript does.
 *   AISHELL-3 writes its pinyin after tone sandhi (`你 ni2 好 hao3`,
 *   `一 yi2 样 yang4`), so a tone that sandhi explains counts as read
 *   correctly: 3 written as 2, and 一 yī or 不 bù written with another tone.
 */

import { textToIpa } from '../src/g2p/index.js';
import { hanziToPinyin } from '../src/g2p/chinese.js';
import { splitTone } from '../src/g2p/pinyin.js';

/**
 * @param {string} lang
 * @param {Iterable<string>} lines
 * @param {{missing?: number}} [options]
 * @returns {{words: number, known: number, share: number,
 *   missing: [string, number][]}}
 */
export function coverage(lang, lines, options = {}) {
  const { missing: keep = 50 } = options;
  let words = 0;
  let known = 0;
  const missing = new Map();
  for (const line of lines) {
    if (!line || !line.trim()) {
      continue;
    }
    for (const word of textToIpa(line, { lang }).words) {
      words++;
      if (word.source === 'rules') {
        const key = word.text.toLowerCase();
        missing.set(key, (missing.get(key) ?? 0) + 1);
      } else {
        known++;
      }
    }
  }
  return {
    words,
    known,
    share: words === 0 ? 0 : known / words,
    missing: [...missing]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, keep),
  };
}

/**
 * Parse a line of AISHELL-3 content.txt:
 * `SSB00050001.wav\t广 guang3 州 zhou1 ...`.
 * @returns {{id: string, chars: string[], pinyin: string[]}|null}
 */
export function parseAishellLine(line) {
  const [id, rest] = line.split('\t');
  if (!rest) {
    return null;
  }
  const parts = rest.trim().split(/\s+/);
  if (parts.length % 2 !== 0) {
    return null;
  }
  const chars = [];
  const pinyin = [];
  for (let index = 0; index < parts.length; index += 2) {
    chars.push(parts[index]);
    pinyin.push(parts[index + 1]);
  }
  return { id, chars, pinyin };
}

/**
 * True when `ours` (toned pinyin before sandhi, `hǎo`) is what the
 * transcript wrote (`hao2`), allowing for tone sandhi.
 * @param {string} char
 * @param {string|null} ours
 * @param {string} theirs
 */
export function sameReading(char, ours, theirs) {
  const a = ours ? splitTone(ours) : null;
  const b = splitTone(theirs);
  if (!a || !b || a.letters !== b.letters) {
    return false;
  }
  if (a.tone === b.tone) {
    return true;
  }
  if (a.tone === 3 && b.tone === 2) {
    return true;
  }
  return (char === '一' && a.tone === 1) || (char === '不' && a.tone === 4);
}

/**
 * Our pinyin per character of a transcript line; an erhua `r` is read as
 * the syllable of its 儿, as AISHELL-3 writes it.
 */
function readLine(chars) {
  const items = hanziToPinyin(chars.join(''));
  return items.map((item, index) => {
    if (item.erhua) {
      return 'er5';
    }
    return items[index + 1]?.erhua && item.pinyin
      ? item.pinyin.replace(/r$/, '')
      : item.pinyin;
  });
}

/**
 * @param {Iterable<string>} lines AISHELL-3 content.txt lines
 * @param {{errors?: number}} [options] how many of the most frequent
 *   misread characters to return
 * @returns {{syllables: number, correct: number, share: number,
 *   errors: number, misread: [string, number][]}}
 */
export function aishellAccuracy(lines, options = {}) {
  const { errors: keep = 30 } = options;
  let syllables = 0;
  let correct = 0;
  const misread = new Map();
  for (const line of lines) {
    const parsed = parseAishellLine(line);
    if (!parsed || parsed.chars.some((char) => [...char].length !== 1)) {
      continue;
    }
    const ours = readLine(parsed.chars);
    parsed.chars.forEach((char, index) => {
      syllables++;
      const theirs = parsed.pinyin[index];
      if (
        sameReading(char, ours[index], theirs) ||
        (char === '儿' && ours[index] === 'er5' && /^er\d$/.test(theirs))
      ) {
        correct++;
      } else {
        const key = `${char} ${ours[index]}→${theirs}`;
        misread.set(key, (misread.get(key) ?? 0) + 1);
      }
    });
  }
  return {
    syllables,
    correct,
    share: syllables === 0 ? 0 : correct / syllables,
    errors: syllables - correct,
    misread: [...misread]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, keep),
  };
}

/** Every tenth line (index 0, 10, 20, ...): held out from mining. */
export function heldOut(lines) {
  return lines.filter((_, index) => index % 10 === 0);
}
