/**
 * English (General American) grapheme-to-phoneme conversion.
 *
 * Lookup order: generated CMUdict subset, simple suffix stripping on top of
 * dictionary stems, then spelling rules. Each word reports its source so
 * the UI can highlight guesses.
 */

import { ENGLISH_DICTIONARY } from './english-dict.js';
import { englishNumberWords, spellToIpa } from './english-rules.js';

let dictionary = null;

/**
 * Hand-written entries missing from the generated subset: number words
 * and the words the text normaliser generates (units, currencies).
 */
const SUPPLEMENT =
  "thirteen=θɝˈtin fourteen=fɔɹˈtin sixteen=sɪkˈstin seventeen=ˌsɛvənˈtin eighteen=eɪˈtin nineteen=naɪnˈtin seventy=ˈsɛvənti eighty=ˈeɪti ninety=ˈnaɪnti o'clock=əˈklɑk cetera=ˈsɛtəɹə missus=ˈmɪsɪz miz=ˈmɪz euro=ˈjʊɹoʊ euros=ˈjʊɹoʊz rupee=ɹuˈpi rupees=ɹuˈpiz ruble=ˈɹubəl rubles=ˈɹubəlz kopeck=ˈkoʊpɛk kopecks=ˈkoʊpɛks paisa=ˈpaɪsɑ paise=ˈpaɪseɪ yuan=juˈɑn fen=ˈfɛn celsius=ˈsɛlsiəs fahrenheit=ˈfɛɹənˌhaɪt kilogram=ˈkɪləˌɡɹæm kilograms=ˈkɪləˌɡɹæmz kilometer=kɪˈlɑmətɚ kilometers=kɪˈlɑmətɚz centimeter=ˈsɛntəˌmitɚ centimeters=ˈsɛntəˌmitɚz millimeter=ˈmɪləˌmitɚ millimeters=ˈmɪləˌmitɚz milligram=ˈmɪləˌɡɹæm milligrams=ˈmɪləˌɡɹæmz liter=ˈlitɚ liters=ˈlitɚz milliliter=ˈmɪləˌlitɚ milliliters=ˈmɪləˌlitɚz millisecond=ˈmɪləˌsɛkənd milliseconds=ˈmɪləˌsɛkəndz hertz=ˈhɝts kilohertz=ˈkɪləˌhɝts megabyte=ˈmɛɡəˌbaɪt megabytes=ˈmɛɡəˌbaɪts gigabyte=ˈɡɪɡəˌbaɪt gigabytes=ˈɡɪɡəˌbaɪts";

function getDictionary() {
  if (!dictionary) {
    dictionary = new Map(
      `${ENGLISH_DICTIONARY} ${SUPPLEMENT}`.split(' ').map((entry) => {
        const split = entry.indexOf('=');
        return [entry.slice(0, split), entry.slice(split + 1)];
      })
    );
  }
  return dictionary;
}

const VOICELESS_FINAL = /[ptkfθ]$/;
const SIBILANT_FINAL = /(?:s|z|ʃ|ʒ|t͡ʃ|d͡ʒ)$/;

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

function pluralEnding(ipa) {
  if (SIBILANT_FINAL.test(ipa)) {
    return 'ɪz';
  }
  return VOICELESS_FINAL.test(ipa) ? 's' : 'z';
}

function pastEnding(ipa) {
  if (/[td]$/.test(ipa)) {
    return 'ɪd';
  }
  return VOICELESS_FINAL.test(ipa) || SIBILANT_FINAL.test(ipa) ? 't' : 'd';
}

function lookupWithSuffix(word) {
  const words = getDictionary();
  for (const [suffix, stems, pronounce] of SUFFIXES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) {
      continue;
    }
    const stem = stems(word).find((candidate) => words.has(candidate));
    if (stem) {
      return pronounce(words.get(stem));
    }
  }
  return null;
}

/**
 * Pronounce one English word.
 * @param {string} word
 * @returns {{ipa: string, source: 'dictionary'|'morphology'|'rules'}}
 */
export function englishWordToIpa(word) {
  const lower = word.toLowerCase().replaceAll('’', "'");
  const known = getDictionary().get(lower);
  if (known) {
    return { ipa: known, source: 'dictionary' };
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

/** Number of words in the bundled dictionary. */
export function englishDictionarySize() {
  return getDictionary().size;
}
