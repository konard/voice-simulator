/**
 * English (General American) grapheme-to-phoneme conversion.
 *
 * Lookup order: generated CMUdict subset, simple suffix stripping on top of
 * dictionary stems, then spelling rules. Each word reports its source so
 * the UI can highlight guesses.
 */

import { ENGLISH_DICTIONARY } from './english-dict.js';
import { ENGLISH_HETERONYMS } from './english-heteronyms.js';
import { selectReading } from './english-context.js';
import {
  SIBILANT_FINAL,
  VOICELESS_FINAL,
  englishNumberWords,
  pluralEnding,
  spellToIpa,
} from './english-rules.js';

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
 *
 * Heteronyms (`record`, `read`, `live`, see `english-heteronyms.js`) are
 * looked up first: with a `context` the reading that fits it is chosen
 * (`english-context.js`) and reported with source `heteronym` and the
 * tag that chose it; without one the first (default) reading is used.
 * @param {string} word
 * @param {{before?: string[], after?: string[], sentence?: string[]}} [context]
 *   lowercased words before the word (nearest first) and after it in the
 *   same clause, and all words of the sentence
 * @returns {{ipa: string, source: 'heteronym'|'dictionary'|'morphology'|'rules',
 *   tag?: string}}
 */
export function englishWordToIpa(word, context) {
  const lower = word.toLowerCase().replaceAll('’', "'");
  if (Object.hasOwn(ENGLISH_HETERONYMS, lower)) {
    const readings = ENGLISH_HETERONYMS[lower];
    const { reading, tag } = context
      ? selectReading(readings, context)
      : { reading: readings[0], tag: readings[0].tags };
    return { ipa: reading.ipa, source: 'heteronym', tag };
  }
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
