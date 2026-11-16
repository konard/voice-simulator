/**
 * English (General American) grapheme-to-phoneme conversion.
 *
 * Lookup order: user lexicons, heteronyms, the shipped lexicon
 * (`src/g2p/lexicon/en.js`, CMUdict with every variant), simple suffix
 * stripping on top of known stems, then spelling rules. Each word reports its source so
 * the UI can highlight guesses.
 */

import { ENGLISH_HETERONYMS } from './english-heteronyms.js';
import { selectReading } from './english-context.js';
import {
  SIBILANT_FINAL,
  VOICELESS_FINAL,
  englishNumberWords,
  pluralEnding,
  spellToIpa,
} from './english-rules.js';
import { lexiconFor, userPronunciation } from './lexicon.js';

/** The user or shipped pronunciation of a word and its source, or null. */
function lookupWord(word) {
  const user = userPronunciation('en', word);
  if (user) {
    return { ipa: user, source: 'user' };
  }
  const shipped = lexiconFor('en').lookup(word);
  return shipped ? { ipa: shipped[0], source: 'dictionary' } : null;
}

/** Suffix handlers: [suffix, stem candidates, pronounce(stemIpa)]. */
const SUFFIXES = [
  ["'s", (word) => [word.slice(0, -2)], (ipa) => `${ipa}${pluralEnding(ipa)}`],
  ['s', (word) => [word.slice(0, -1)], (ipa) => `${ipa}${pluralEnding(ipa)}`],
  ['es', (word) => [word.slice(0, -2)], (ipa) => `${ipa}${pluralEnding(ipa)}`],
  [
    'ed',
    (word) => [word.slice(0, -2), word.slice(0, -1), word.slice(0, -3)],
    (ipa) => `${ipa}${pastEnding(ipa)}`,
  ],
  [
    'ing',
    (word) => [word.slice(0, -3), `${word.slice(0, -3)}e`, word.slice(0, -4)],
    (ipa) => `${ipa}ɪŋ`,
  ],
  ['ly', (word) => [word.slice(0, -2)], (ipa) => `${ipa}li`],
  ['er', (word) => [word.slice(0, -2), word.slice(0, -1)], (ipa) => `${ipa}ɚ`],
  ['ness', (word) => [word.slice(0, -4)], (ipa) => `${ipa}nəs`],
];

function pastEnding(ipa) {
  if (/[td]$/.test(ipa)) {
    return 'ɪd';
  }
  return VOICELESS_FINAL.test(ipa) || SIBILANT_FINAL.test(ipa) ? 't' : 'd';
}

function lookupWithSuffix(word) {
  for (const [suffix, stems, pronounce] of SUFFIXES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) {
      continue;
    }
    for (const stem of stems(word)) {
      const known = lookupWord(stem);
      if (known) {
        return pronounce(known.ipa);
      }
    }
  }
  return null;
}

/**
 * Pronounce one English word.
 *
 * Heteronyms (`record`, `read`, `live`, see `english-heteronyms.js`) are
 * looked up first: with a `context` the reading that fits it is chosen
 * (`english-context.js`) and reported with source `heteronym` and the
 * tag that chose it; without one the first (default) reading is used.
 * @param {string} word
 * @param {{before?: string[], after?: string[], sentence?: string[]}} [context]
 *   lowercased words before the word (nearest first) and after it in the
 *   same clause, and all words of the sentence
 * @returns {{ipa: string,
 *   source: 'user'|'heteronym'|'dictionary'|'morphology'|'rules',
 *   tag?: string}}
 */
export function englishWordToIpa(word, context) {
  const lower = word.toLowerCase().replaceAll('’', "'");
  const user = userPronunciation('en', lower);
  if (user) {
    return { ipa: user, source: 'user' };
  }
  if (Object.hasOwn(ENGLISH_HETERONYMS, lower)) {
    const readings = ENGLISH_HETERONYMS[lower];
    const { reading, tag } = context
      ? selectReading(readings, context)
      : { reading: readings[0], tag: readings[0].tags };
    return { ipa: reading.ipa, source: 'heteronym', tag };
  }
  const known = lookupWord(lower);
  if (known) {
    return known;
  }
  const derived = lookupWithSuffix(lower);
  if (derived) {
    return { ipa: derived, source: 'morphology' };
  }
  return { ipa: spellToIpa(lower), source: 'rules' };
}

/**
 * Expand digits into English words before pronunciation.
 * @param {string} token
 * @returns {string[]}
 */
export function expandEnglishNumber(token) {
  return englishNumberWords(Number(token));
}

/** Number of words in the shipped English lexicon. */
export function englishDictionarySize() {
  return lexiconFor('en').size;
}
