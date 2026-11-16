/**
 * English (General American) grapheme-to-phoneme conversion.
 *
 * Lookup order: user lexicons, heteronyms, the shipped lexicon
 * (`src/g2p/lexicon/en.js`, CMUdict with every variant), suffixes on known
 * stems and compounds of known words (`english-morphology.js`), then
 * spelling rules. Each word reports its source so
 * the UI can highlight guesses.
 */

import { ENGLISH_HETERONYMS } from './english-heteronyms.js';
import { selectReading } from './english-context.js';
import { englishNumberWords, spellToIpa } from './english-rules.js';
import { deriveEnglish } from './english-morphology.js';
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
  const derived = deriveEnglish(lower, (stem) => lookupWord(stem)?.ipa ?? null);
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
