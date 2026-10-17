/**
 * Text to IPA for English, Russian, Hindi and Mandarin Chinese.
 *
 * The text is split into words, numbers and punctuation. Each word is
 * routed by its script (Latin, Cyrillic, Devanagari, Han) so mixed-language
 * input works; Latin text is read as pinyin when the language is Chinese
 * and the word is valid pinyin. Punctuation becomes IPA prosodic breaks.
 */

import { englishNumberWords } from './english-rules.js';
import { englishWordToIpa } from './english.js';
import {
  hindiNumberWords,
  hindiWordToIpa,
  normalizeDevanagariDigits,
} from './hindi.js';
import { chineseNumber, chineseWordToIpa, isPinyin } from './chinese.js';
import { russianNumberWords, russianWordToIpa } from './russian.js';

/** Supported languages with display names and sample sentences. */
export const LANGUAGES = Object.freeze({
  en: {
    code: 'en',
    name: 'English',
    native: 'English',
    sample: 'Hello! This voice is simulated by sound waves in a 3D head.',
  },
  ru: {
    code: 'ru',
    name: 'Russian',
    native: 'Русский',
    sample: 'Привет! Этот голос рождается из звуковых волн в модели головы.',
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    native: 'हिन्दी',
    sample: 'नमस्ते! यह आवाज़ सिर के मॉडल में ध्वनि तरंगों से बनती है।',
  },
  zh: {
    code: 'zh',
    name: 'Chinese (Mandarin)',
    native: '中文',
    sample: '你好！这个声音是由头部模型里的声波模拟出来的。',
  },
});

const WORD_PRONOUNCERS = {
  en: englishWordToIpa,
  ru: russianWordToIpa,
  hi: hindiWordToIpa,
  zh: chineseWordToIpa,
};

const NUMBER_SPELLERS = {
  en: englishNumberWords,
  ru: russianNumberWords,
  hi: hindiNumberWords,
  zh: (value) => [chineseNumber(value)],
};

const SCRIPT_TESTS = [
  ['ru', /\p{Script=Cyrillic}/u],
  ['hi', /\p{Script=Devanagari}/u],
  ['zh', /\p{Script=Han}/u],
  ['en', /\p{Script=Latin}/u],
];

const PUNCTUATION_BREAKS = {
  '.': '.',
  '!': '.',
  '…': '.',
  '。': '.',
  '！': '.',
  '।': '.',
  '॥': '.',
  '?': '?',
  '？': '?',
  ',': '|',
  ';': '|',
  ':': '|',
  '—': '|',
  '–': '|',
  '，': '|',
  '、': '|',
  '；': '|',
  '：': '|',
};

const TOKEN_PATTERN =
  /\p{Script=Han}+|(?:[\p{L}\p{M}'’+]+\d?)+|\d+(?:[.,]\d+)?|[.!?…。！？।॥,;:—–，、；：]/gu;

/**
 * Detect the script-based language of a word or text.
 * @param {string} text
 * @returns {'en'|'ru'|'hi'|'zh'|null}
 */
export function scriptLanguage(text) {
  return SCRIPT_TESTS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/**
 * Guess the dominant language of a text by counting letters per script.
 * @param {string} text
 * @returns {'en'|'ru'|'hi'|'zh'}
 */
export function detectLanguage(text) {
  const counts = { en: 0, ru: 0, hi: 0, zh: 0 };
  for (const char of String(text ?? '')) {
    const language = scriptLanguage(char);
    if (language) {
      // Han characters carry about a word each, so weight them higher.
      counts[language] += language === 'zh' ? 3 : 1;
    }
  }
  const [best, count] = Object.entries(counts).sort(
    (left, right) => right[1] - left[1]
  )[0];
  return count > 0 ? best : 'en';
}

function wordLanguage(word, preferred) {
  const script = scriptLanguage(word);
  if (script === 'en' && preferred === 'zh' && isPinyin(word)) {
    return 'zh';
  }
  return script ?? preferred;
}

function pronounceNumber(token, language) {
  const value = Number(token.replace(',', '.'));
  const integer = Number.isInteger(value) ? value : Math.trunc(value);
  const words = NUMBER_SPELLERS[language](integer);
  return words.map((word) => pronounceWord(word, language));
}

function pronounceWord(word, language) {
  const result = WORD_PRONOUNCERS[language](word);
  return { text: word, lang: language, ...result };
}

/** Pronounce a word; letters mixed with digits (mp3) are split unless pinyin. */
function pronounceMixed(token, language) {
  if (language === 'zh' || !/\d/.test(token)) {
    return [pronounceWord(token, language)];
  }
  return token
    .split(/(\d)/)
    .filter(Boolean)
    .flatMap((part) =>
      /\d/.test(part)
        ? pronounceNumber(part, language)
        : [pronounceWord(part, language)]
    );
}

function addBreak(items, symbol) {
  const last = items.at(-1);
  if (!last) {
    return;
  }
  if (last.break) {
    if (symbol !== '|') {
      last.ipa = symbol;
    }
    return;
  }
  items.push({ text: symbol, ipa: symbol, break: true });
}

/**
 * Convert text to IPA.
 * @param {string} text
 * @param {{lang?: 'auto'|'en'|'ru'|'hi'|'zh'}} [options]
 * @returns {{lang: string, ipa: string, words: object[]}}
 */
export function textToIpa(text, options = {}) {
  const source = normalizeDevanagariDigits(String(text ?? ''));
  const requested = options.lang ?? 'auto';
  const lang =
    requested === 'auto' || !WORD_PRONOUNCERS[requested]
      ? detectLanguage(source)
      : requested;
  const items = [];
  let current = lang;
  for (const [token] of source.matchAll(TOKEN_PATTERN)) {
    if (PUNCTUATION_BREAKS[token]) {
      addBreak(items, PUNCTUATION_BREAKS[token]);
    } else if (/^\d/.test(token)) {
      items.push(...pronounceNumber(token, current));
    } else {
      current = wordLanguage(token, lang);
      items.push(...pronounceMixed(token, current));
    }
  }
  const ipa = items
    .map((item) => item.ipa)
    .filter(Boolean)
    .join(' ')
    .replace(/ ([.?|])/g, ' $1');
  return { lang, ipa, words: items.filter((item) => !item.break) };
}
