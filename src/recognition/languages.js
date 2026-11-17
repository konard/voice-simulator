/** Shared forward rules; the reverse lexicon never stores stale IPA. */
import { englishWordToIpa } from '../g2p/english.js';
import { russianWordToIpa } from '../g2p/russian.js';
import { hindiWordToIpa } from '../g2p/hindi.js';
import { chineseWordToIpa } from '../g2p/chinese.js';

export const RECOGNITION_LANGUAGES = ['en', 'ru', 'hi', 'zh'];

export function pronounce(word, language) {
  switch (language) {
    case 'en':
      return englishWordToIpa(word);
    case 'ru':
      return russianWordToIpa(word);
    case 'hi':
      return hindiWordToIpa(word);
    case 'zh':
      return chineseWordToIpa(word);
    default:
      throw new RangeError(`unsupported recognition language "${language}"`);
  }
}

export function checkLanguage(language) {
  if (!RECOGNITION_LANGUAGES.includes(language)) {
    throw new RangeError(`unsupported recognition language "${language}"`);
  }
}
