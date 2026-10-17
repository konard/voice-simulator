/**
 * Text to IPA for English, Russian, Hindi and Mandarin Chinese.
 *
 * The text is normalised first (numbers, dates, money, abbreviations,
 * see `normalize.js`), then each word is routed by its script (Latin,
 * Cyrillic, Devanagari, Han) so mixed-language input works; Latin text is
 * read as pinyin when the language is Chinese and the word is valid
 * pinyin. Punctuation becomes prosodic breaks: `.` `?` `!` `…` `,` `;`
 * `|` (dash), `(` `)` and `"`, and questions opening with a question word
 * get a falling `↘` contour. Every word keeps `sourceStart`/`sourceEnd`
 * (UTF-16 offsets into the input) and the `original` text it came from.
 */

import { englishWordToIpa } from './english.js';
import { hindiWordToIpa, normalizeDevanagariDigits } from './hindi.js';
import { chineseSyllables, chineseWordToIpa, isPinyin } from './chinese.js';
import { russianWordToIpa } from './russian.js';
import { VERBALIZERS, normalizeText } from './normalize.js';
import {
  adaptEnglishWord,
  hasLinkingR,
  isNonRhotic,
  resolveAccent,
} from './accents.js';

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

const SCRIPT_TESTS = [
  ['ru', /\p{Script=Cyrillic}/u],
  ['hi', /\p{Script=Devanagari}/u],
  ['zh', /\p{Script=Han}/u],
  ['en', /\p{Script=Latin}/u],
];

/**
 * Break symbols in the IPA output, ranked: when breaks meet (`?!`, `.,`)
 * the stronger one is kept. Brackets and quotes are always kept.
 */
const BREAK_RANKS = { ',': 1, '|': 2, ';': 3, '…': 4, '.': 5, '!': 6, '?': 7 };
const ENCLOSING_BREAKS = new Set(['(', ')', '"']);

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

function pronounceWord(word, language) {
  const result = WORD_PRONOUNCERS[language](word);
  return { text: word, lang: language, ...result };
}

/** Pronounce a normalised word item in its accent. */
function pronounceItem(item, source, accent) {
  return pronounceSource(item, source).map((word) => {
    if (word.lang !== 'en' || !word.ipa) {
      return word;
    }
    const ipa = adaptEnglishWord(word.ipa, word.text, accent);
    return { ...word, ipa, linkingR: hasLinkingR(word.ipa) };
  });
}

/** Pronounce a normalised word item, keeping its source range. */
function pronounceSource(item, source) {
  const { sourceStart, sourceEnd, token } = item;
  const original = source.slice(sourceStart, sourceEnd);
  const range = { sourceStart, sourceEnd, original, token };
  if (item.ipa) {
    const extra = item.letter ? { letter: true } : {};
    return [
      { text: item.text, lang: item.lang, ipa: item.ipa, ...extra, ...range },
    ];
  }
  if (
    item.lang === 'zh' &&
    item.text === original &&
    /\p{Script=Han}/u.test(original)
  ) {
    return splitHanRun(item, range);
  }
  return [
    {
      ...pronounceWord(item.say ?? item.text, item.lang),
      text: item.text,
      ...range,
    },
  ];
}

/**
 * Split a run of Hanzi into dictionary words, so each can be highlighted
 * on its own; tone sandhi is still applied across the whole run.
 */
function splitHanRun(item, range) {
  const groups = new Map();
  let offset = item.sourceStart;
  for (const syllable of chineseSyllables(item.text)) {
    const group = groups.get(syllable.group) ?? {
      text: '',
      syllables: [],
      sourceStart: offset,
    };
    group.text += syllable.char;
    group.syllables.push(syllable);
    offset += syllable.char.length;
    group.sourceEnd = offset;
    groups.set(syllable.group, group);
  }
  return [...groups.values()]
    .map((group) => {
      const known = group.syllables.filter((syllable) => syllable.ipa);
      return {
        text: group.text,
        lang: 'zh',
        ipa: known.map((syllable) => syllable.ipa).join(' '),
        pinyin: known.map((syllable) => syllable.pinyin).join(' '),
        source: 'dictionary',
        ...range,
        sourceStart: group.sourceStart,
        sourceEnd: group.sourceEnd,
        original: group.text,
      };
    })
    .filter((word) => word.ipa);
}

function addBreak(items, item) {
  const { symbol } = item;
  const last = items.at(-1);
  const enclosing = ENCLOSING_BREAKS.has(symbol);
  if (!last && !enclosing) {
    return;
  }
  if (last?.break && !enclosing && BREAK_RANKS[last.ipa]) {
    if (BREAK_RANKS[symbol] > BREAK_RANKS[last.ipa]) {
      last.ipa = symbol;
      last.text = symbol;
    }
    return;
  }
  items.push({
    text: symbol,
    ipa: symbol,
    break: true,
    sourceStart: item.sourceStart,
  });
}

/**
 * Questions that start with a question word (who, what, ...) fall at the
 * at the end: mark them with `↘` before the `?`.
 */
function markQuestions(items) {
  let sentence = [];
  for (const item of items) {
    if (!item.break) {
      sentence.push(item);
      continue;
    }
    if (item.ipa === '?') {
      const opening = sentence.slice(0, 2);
      const wh = opening.some((word) =>
        VERBALIZERS[word.lang]?.isWhWord(word.text.toLowerCase())
      );
      if (wh) {
        item.ipa = '↘ ?';
      }
    }
    if ('.!?…'.includes(item.ipa.at(-1))) {
      sentence = [];
    }
  }
}

/**
 * Non-rhotic accents pronounce a final r before a vowel: `far away`
 * fɑːɹ əˈweɪ.
 */
function linkRs(items, accent) {
  if (!isNonRhotic(accent)) {
    return;
  }
  items.forEach((item, index) => {
    const next = items[index + 1];
    if (
      item.linkingR &&
      next?.lang === 'en' &&
      /^ˈ?ˌ?[aeiouæɑɒɔəɛɪʊʌɜ]/u.test(next.ipa)
    ) {
      item.ipa += 'ɹ';
    }
  });
}

/**
 * Convert text to IPA.
 * @param {string} text
 * @param {{lang?: 'auto'|'en'|'ru'|'hi'|'zh', accent?: string}} [options]
 *   `accent` picks an English accent (`en-US`, `en-GB`, `en-AU`,
 *   `en-IN`; see `accents.js`).
 * @returns {{lang: string, accent: string|null, ipa: string, words: object[]}}
 */
export function textToIpa(text, options = {}) {
  const source = normalizeDevanagariDigits(String(text ?? ''));
  const requested = options.lang ?? 'auto';
  const lang =
    requested === 'auto' || !WORD_PRONOUNCERS[requested]
      ? detectLanguage(source)
      : requested;
  const items = [];
  const accent = resolveAccent('en', options.accent);
  const normalized = normalizeText(source, {
    lang,
    wordLanguage: (word) => wordLanguage(word, lang),
  });
  for (const item of normalized) {
    if (item.kind === 'break') {
      addBreak(items, item);
    } else {
      items.push(...pronounceItem(item, source, accent));
    }
  }
  markQuestions(items);
  linkRs(items, accent);
  const ipa = items
    .map((item) => item.ipa)
    .filter(Boolean)
    .join(' ');
  return {
    lang,
    accent: resolveAccent(lang, options.accent),
    ipa,
    words: items.filter((item) => !item.break),
  };
}
