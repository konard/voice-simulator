/**
 * English words built from known words: a suffix on a known stem
 * (`atrocities` = `atrocity` + `-ies`, `conditioners` = `condition` +
 * `-er` + `-s`) or two known words (`congresswoman`). Used by `english.js`
 * for words outside the lexicons (source `morphology`) and by
 * `scripts/build-lexicon.mjs`, which leaves out of the shipped lexicon the
 * words whose only CMUdict pronunciation these rules give.
 */

import { VOICELESS_FINAL, pluralEnding } from './english-rules.js';

const STRESS = /[ˈˌ]/;

/** Voiceless sibilants (`s`, `ʃ`, `t͡ʃ`); `z`, `ʒ` and `d͡ʒ` are voiced. */
const VOICELESS_SIBILANT = /[sʃ]$/;

function pastEnding(ipa) {
  if (/[td]$/.test(ipa)) {
    return 'ɪd';
  }
  return VOICELESS_FINAL.test(ipa) || VOICELESS_SIBILANT.test(ipa) ? 't' : 'd';
}

const plural = (ipa) => `${ipa}${pluralEnding(ipa)}`;
const cut = (word, length) => word.slice(0, -length);

/**
 * Suffix handlers, tried in this order: [suffix, stem candidates,
 * pronounce(stemIpa)]. The `y` of a stem written `i` before a suffix is
 * restored (`atrocities`, `stealthily`, `happiness`); a final `e` dropped before a vowel
 * is tried (`intriguing`, `absolutism`), and so is a doubled consonant
 * (`bums`, `stopped`).
 */
export const ENGLISH_SUFFIXES = Object.freeze([
  ["'s", (word) => [cut(word, 2)], plural],
  ['ies', (word) => [`${cut(word, 3)}y`], (ipa) => `${ipa}z`],
  ['s', (word) => [cut(word, 1)], plural],
  ['es', (word) => [cut(word, 2)], plural],
  ['ied', (word) => [`${cut(word, 3)}y`], (ipa) => `${ipa}d`],
  [
    'ed',
    (word) => [cut(word, 2), cut(word, 1), cut(word, 3)],
    (ipa) => `${ipa}${pastEnding(ipa)}`,
  ],
  [
    'ing',
    (word) => [cut(word, 3), `${cut(word, 3)}e`, cut(word, 4)],
    (ipa) => `${ipa}ɪŋ`,
  ],
  [
    'est',
    (word) => [cut(word, 3), cut(word, 2), cut(word, 4)],
    (ipa) => `${ipa}ɪst`,
  ],
  ['ily', (word) => [`${cut(word, 3)}y`], (ipa) => `${ipa}li`],
  ['ly', (word) => [cut(word, 2)], (ipa) => `${ipa}li`],
  ['er', (word) => [cut(word, 2), cut(word, 1)], (ipa) => `${ipa}ɚ`],
  ['ness', (word) => [cut(word, 4), `${cut(word, 5)}y`], (ipa) => `${ipa}nəs`],
  ['ism', (word) => [cut(word, 3), `${cut(word, 3)}e`], (ipa) => `${ipa}ˌɪzəm`],
  ['ize', (word) => [cut(word, 3), `${cut(word, 3)}e`], (ipa) => `${ipa}ˌaɪz`],
  ['ment', (word) => [cut(word, 4)], (ipa) => `${ipa}mənt`],
  ['ful', (word) => [cut(word, 3)], (ipa) => `${ipa}fəl`],
  ['less', (word) => [cut(word, 4)], (ipa) => `${ipa}ləs`],
  ['y', (word) => [cut(word, 1), cut(word, 2)], (ipa) => `${ipa}i`],
  ['ish', (word) => [cut(word, 3), cut(word, 4)], (ipa) => `${ipa}ɪʃ`],
  ['able', (word) => [cut(word, 4), `${cut(word, 4)}e`], (ipa) => `${ipa}əbəl`],
  ['ship', (word) => [cut(word, 4)], (ipa) => `${ipa}ˌʃɪp`],
  ['hood', (word) => [cut(word, 4)], (ipa) => `${ipa}ˌhʊd`],
]);

/** The shortest part of a compound (`pin` + `point`). */
const COMPOUND_PART = 3;

function withSuffix(word, lookup, depth) {
  for (const [suffix, stems, pronounce] of ENGLISH_SUFFIXES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) {
      continue;
    }
    for (const stem of stems(word)) {
      const known =
        lookup(stem) ??
        (depth > 0 ? withSuffix(stem, lookup, depth - 1) : null);
      if (known) {
        return pronounce(known);
      }
    }
  }
  return null;
}

/** Unstressed prefixes on a known word: [prefix, pronunciation]. */
export const ENGLISH_PREFIXES = Object.freeze([
  ['un', 'ʌn'],
  ['dis', 'dɪs'],
  ['mis', 'mɪs'],
  ['re', 'ɹi'],
  ['non', 'ˌnɑn'],
  ['over', 'ˌoʊvɚ'],
  ['under', 'ˌʌndɚ'],
  ['out', 'ˌaʊt'],
]);

function withPrefix(word, lookup) {
  for (const [prefix, ipa] of ENGLISH_PREFIXES) {
    const rest = word.slice(prefix.length);
    if (word.startsWith(prefix) && rest.length >= COMPOUND_PART) {
      const known = lookup(rest) ?? withSuffix(rest, lookup, 1);
      if (known && /ˈ/.test(known)) {
        return `${ipa}${known}`;
      }
    }
  }
  return null;
}

/** The second word of a compound loses its primary stress. */
function compound(word, lookup) {
  for (
    let split = word.length - COMPOUND_PART;
    split >= COMPOUND_PART;
    split--
  ) {
    const first = lookup(word.slice(0, split));
    const second = first && lookup(word.slice(split));
    if (second && STRESS.test(first)) {
      return `${first}${second.replace('ˈ', 'ˌ')}`;
    }
  }
  return null;
}

/**
 * The pronunciation of a word made of known words, or null.
 * @param {string} word lower case
 * @param {(word: string) => string|null} lookup the default pronunciation
 *   of a known word
 * @returns {string|null}
 */
export function deriveEnglish(word, lookup) {
  if (word.includes("'") && !word.endsWith("'s")) {
    return null;
  }
  return (
    withSuffix(word, lookup, 1) ??
    withPrefix(word, lookup) ??
    compound(word, lookup)
  );
}
