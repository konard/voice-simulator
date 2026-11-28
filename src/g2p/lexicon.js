/**
 * Pronunciation lexicons (issue 47): the shipped word lists of
 * `src/g2p/lexicon/` and the lexicons a user adds.
 *
 * Every word is looked up in this order: (1) the `lexicon` option of
 * `textToIpa()`, (2) lexicons added with `addLexicon()`, the most recent
 * first, both reported with `source: 'user'`; (3) the shipped lexicon,
 * `'dictionary'`; then the language falls back to its suffix rules
 * (`'morphology'`) and letter rules (`'rules'`).
 *
 * A user lexicon maps words to pronunciations: IPA for English, Hindi and
 * Russian (`{quinoa: 'kiˈnoʊə'}`), toned pinyin with one syllable per
 * character for Chinese (`{重庆: 'chóng qìng'}`). A value may also be a
 * list of variants, the first being the default. A user lexicon is either
 * such a plain object, the JSON written by `build-lexicon.mjs --full`
 * (`{format: 'lexicon', words: {...}}`) or a `vslex` container.
 *
 * The shipped parts are `en`/`words`, `hi`/`words` (IPA), `ru`/`forms`
 * (the stressed vowel of a whole form: `a` first, `z` last; also named
 * `stress`), `ru`/`stems` (the stressed vowel of a stem or `+`, the
 * ending; see `findRussianStress()`) and `zh`/`phrases` (one
 * reading letter per character, see `chinese-readings.js`). Nothing is
 * decoded before the first lookup.
 */

import { EN_LEXICON } from './lexicon/en.js';
import { HI_LEXICON } from './lexicon/hi.js';
import { RU_FORMS, RU_STEMS } from './lexicon/ru.js';
import { ZH_PHRASES } from './lexicon/zh.js';
import {
  decodeBlock,
  blockTables,
  findBlock,
  indexBlock,
  isVslex,
  storedWord,
} from './vslex.js';
import { pinyinSyllableToIpa } from './pinyin.js';
import { parseIpa } from '../ipa/parse.js';

/** Languages that take a lexicon. */
const LANGS = ['en', 'ru', 'hi', 'zh'];

const SHIPPED_DATA = {
  en: { words: EN_LEXICON },
  hi: { words: HI_LEXICON },
  // `stress` is the name of `forms` before issue 48.
  ru: { forms: RU_FORMS, stems: RU_STEMS, stress: RU_FORMS },
  zh: { phrases: ZH_PHRASES },
};

const opened = new Map();
const blockScans = new WeakMap();
const added = new Map();
const callStack = [];
let spellingIndex = new Map();
let revision = 0;

/** Internal cache generation for consumers of the current forward rules. */
export function lexiconRevision() {
  return revision;
}

/**
 * The lookup key of a word: NFC, lower case, typographic apostrophe as
 * `'`.
 * @param {string} word
 */
export function lexiconKey(word) {
  return String(word).normalize('NFC').toLowerCase().replaceAll('’', "'");
}

function openVslex(data) {
  const tables = blockTables(data);
  const cache = new Map();
  let blocks = cache;
  const block = (index) => {
    if (!blocks.has(index)) {
      if (blocks === cache && cache.size === 64) {
        cache.delete(cache.keys().next().value);
      }
      blocks.set(index, indexBlock(data, index, tables));
    }
    return blocks.get(index);
  };
  const lookup = (word) => {
    const key = lexiconKey(word);
    const stored = storedWord(data, key);
    const index = stored === null ? -1 : findBlock(data, stored);
    return index < 0 ? null : block(index)(key);
  };
  const lexicon = {
    size: data.count,
    has: (word) => lookup(word) !== null,
    lookup,
    *words() {
      for (let index = 0; index < data.blocks.length; index++) {
        for (const [word] of decodeBlock(data, index, tables)) {
          yield word;
        }
      }
    },
  };
  blockScans.set(lexicon, (read) => {
    if (blocks !== cache) {
      return read();
    }
    // Keep each visited block through this scan and retain the bounded
    // dictionary cache when the scan returns.
    blocks = new Map(cache);
    try {
      return read();
    } finally {
      blocks = cache;
    }
  });
  return lexicon;
}

function variantsOf(word, value) {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.some((item) => typeof item !== 'string')) {
    throw new TypeError(
      `lexicon entry "${word}" must be a pronunciation or a list of them`
    );
  }
  return list.map((item) => item.normalize('NFC'));
}

function openObject(words) {
  const map = new Map();
  for (const [word, value] of Object.entries(words)) {
    const key = lexiconKey(word);
    const variants = variantsOf(word, value);
    map.set(key, [...new Set([...(map.get(key) ?? []), ...variants])]);
  }
  const lookup = (word) => {
    const found = map.get(lexiconKey(word));
    return found ? [...found] : null;
  };
  return {
    size: map.size,
    has: (word) => map.has(lexiconKey(word)),
    lookup,
    words: () => map.keys(),
  };
}

/**
 * Open a lexicon for lookups.
 * @param {object} data a `vslex` container, the JSON of
 *   `build-lexicon.mjs --full` or a plain `{word: pronunciation}` object
 * @returns {{size: number, has: (word: string) => boolean,
 *   lookup: (word: string) => string[]|null,
 *   words: () => Iterator<string>}}
 *   `lookup` gives every pronunciation of the word, the default first.
 */
export function openLexicon(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('a lexicon is an object');
  }
  if (isVslex(data)) {
    return openVslex(data);
  }
  if (data.format === 'lexicon') {
    return openObject(data.words ?? {});
  }
  return openObject(data);
}

function checkLang(lang) {
  if (!LANGS.includes(lang)) {
    throw new RangeError(
      `no lexicon for language "${lang}" (use ${LANGS.join(', ')})`
    );
  }
}

/**
 * The shipped lexicon of a language, opened on first use, or null.
 * @param {string} lang `en`, `hi`, `ru` or `zh`
 * @param {string} [part] `words` (en, hi), `forms`, `stems` or `stress`
 *   (ru) or `phrases` (zh);
 *   the first part of the language by default
 */
export function lexiconFor(lang, part) {
  const parts = SHIPPED_DATA[lang];
  const name = part ?? (parts ? Object.keys(parts)[0] : undefined);
  const data = parts?.[name];
  if (!data) {
    return null;
  }
  if (!opened.has(data)) {
    opened.set(data, openVslex(data));
  }
  return opened.get(data);
}

export function scanShippedLexicon(lang, read) {
  const scan = blockScans.get(lexiconFor(lang));
  return scan ? scan(read) : read();
}

/** Why a pronunciation of `lang` cannot be used, or null when it can. */
function entryProblem(lang, word, value) {
  if (lang === 'zh') {
    const syllables = value.trim().split(/\s+/);
    const chars = [...word];
    if (syllables.length !== chars.length) {
      return `${syllables.length} pinyin syllables for ${chars.length} characters`;
    }
    const bad = syllables.find((syllable) => !pinyinSyllableToIpa(syllable));
    return bad ? `"${bad}" is not a pinyin syllable` : null;
  }
  const { tokens, unknown } = parseIpa(value);
  if (unknown.length > 0) {
    return `unknown IPA "${unknown.join('')}"`;
  }
  return tokens.some((token) => token.kind !== 'pause')
    ? null
    : 'no IPA sounds';
}

/** Check every entry of a plain user lexicon; throw a TypeError naming the word. */
function validate(lang, lexicon) {
  for (const word of lexicon.words()) {
    for (const value of lexicon.lookup(word)) {
      const problem = entryProblem(lang, word, value);
      if (problem) {
        throw new TypeError(
          `${lang} lexicon entry "${word}" ("${value}"): ${problem}`
        );
      }
    }
  }
}

/** Open and check a user lexicon of `lang`. */
function openUser(lang, entries) {
  checkLang(lang);
  if (isVslex(entries) && entries.lang && entries.lang !== lang) {
    throw new RangeError(
      `the lexicon is for "${entries.lang}", not for "${lang}"`
    );
  }
  const lexicon = openLexicon(entries);
  if (!isVslex(entries)) {
    validate(lang, lexicon);
  }
  let longest = 0;
  for (const word of lexicon.words()) {
    longest = Math.max(longest, [...word].length);
  }
  return { ...lexicon, longest };
}

/**
 * Add a user lexicon of a language; it wins over the shipped one and over
 * lexicons added before it.
 * @param {string} lang `en`, `ru`, `hi` or `zh`
 * @param {object} entries a plain `{word: pronunciation}` object, the
 *   JSON of `build-lexicon.mjs --full` or a `vslex` container
 * @returns {number} the number of words added
 */
export function addLexicon(lang, entries) {
  const lexicon = openUser(lang, entries);
  added.set(lang, [lexicon, ...(added.get(lang) ?? [])]);
  revision++;
  spellingIndex = new Map();
  return lexicon.size;
}

/** Remove every lexicon added with `addLexicon()`. */
export function clearLexicons() {
  added.clear();
  revision++;
  spellingIndex = new Map();
}

/** The registered overrides as plain data, oldest first for addLexicon(). */
export function registeredLexicons() {
  const dictionaries = [];
  for (const [lang, lexicons] of added) {
    for (const lexicon of lexicons.slice().reverse()) {
      const words = Object.fromEntries(
        Array.from(lexicon.words(), (word) => [word, lexicon.lookup(word)])
      );
      dictionaries.push([lang, words]);
    }
  }
  return dictionaries;
}

/**
 * Run `fn` with the per-call lexicons of `textToIpa(text, {lexicon})`.
 * @param {Record<string, object>|undefined} lexicons `{en: {word: ipa}}`
 * @param {() => T} fn
 * @returns {T}
 * @template T
 */
export function withLexicon(lexicons, fn) {
  if (lexicons === undefined || lexicons === null) {
    return fn();
  }
  if (typeof lexicons !== 'object' || Array.isArray(lexicons)) {
    throw new TypeError(
      'options.lexicon is an object such as {en: {word: ipa}}'
    );
  }
  const frame = new Map(
    Object.entries(lexicons).map(([lang, entries]) => [
      lang,
      openUser(lang, entries),
    ])
  );
  callStack.push(frame);
  try {
    return fn();
  } finally {
    callStack.pop();
  }
}

/** The user lexicons of `lang` in lookup order. */
function userLexicons(lang) {
  if (callStack.length === 0) {
    return added.get(lang) ?? [];
  }
  const call = callStack
    .map((frame) => frame.get(lang))
    .filter(Boolean)
    .reverse();
  return [...call, ...(added.get(lang) ?? [])];
}

/**
 * Every user pronunciation of a word, the one that wins first, or null.
 * @param {string} lang
 * @param {string} word
 * @returns {string[]|null}
 */
export function userPronunciations(lang, word) {
  const lexicons = userLexicons(lang);
  if (lexicons.length < 2) {
    const found = lexicons[0]?.lookup(word);
    return found?.length ? [...new Set(found)] : null;
  }
  const found = lexicons.flatMap((lexicon) => lexicon.lookup(word) ?? []);
  return found.length > 0 ? [...new Set(found)] : null;
}

/**
 * The user pronunciation that wins for a word, or null.
 * @param {string} lang
 * @param {string} word
 */
export function userPronunciation(lang, word) {
  const lexicons = userLexicons(lang);
  if (lexicons.length === 0) {
    return null;
  }
  return userPronunciations(lang, word)?.[0] ?? null;
}

/** The longest user word of `lang`, in characters (0 without any). */
export function longestUserWord(lang) {
  return Math.max(0, ...userLexicons(lang).map((lexicon) => lexicon.longest));
}

const SPOKEN = new Map();

/**
 * Let a language turn a shipped entry that is not IPA (Russian stress,
 * Chinese reading letters) into IPA for `pronunciations()`. Called by the
 * language modules.
 * @param {string} lang
 * @param {(word: string) => string|null} speak
 */
export function registerShippedSpeaker(lang, speak) {
  SPOKEN.set(lang, speak);
}

/** The shipped pronunciations of a word as IPA. */
function shippedPronunciations(lang, word) {
  const lexicon = lexiconFor(lang);
  const found = lexicon?.lookup(word);
  if (!found) {
    return [];
  }
  const speak = SPOKEN.get(lang);
  if (lang === 'en' || lang === 'hi' || typeof speak !== 'function') {
    return found;
  }
  const ipa = speak(lexiconKey(word));
  return ipa ? [ipa] : [];
}

/** User IPA of `lang`: Chinese pinyin is spoken by the registered speaker. */
function userIpa(lang, value, word) {
  if (lang !== 'zh') {
    return value;
  }
  return SPOKEN.get('zh')?.(lexiconKey(word), value) ?? value;
}

/**
 * Every known pronunciation of a word as IPA: user lexicons first, then
 * the shipped lexicon (empty when the word is in neither).
 * @param {string} lang `en`, `ru`, `hi` or `zh`
 * @param {string} word
 * @returns {string[]}
 */
export function pronunciations(lang, word) {
  checkLang(lang);
  const user = (userPronunciations(lang, word) ?? []).map((value) =>
    userIpa(lang, value, word)
  );
  return [...new Set([...user, ...shippedPronunciations(lang, word)])];
}

/**
 * Every word of the user and shipped lexicons of a language, without
 * repeats.
 * @param {string} lang
 * @returns {Generator<string>}
 */
export function* lexiconWords(lang) {
  checkLang(lang);
  const seen = new Set();
  const shipped = lexiconFor(lang);
  for (const lexicon of [...userLexicons(lang), shipped]) {
    for (const word of lexicon.words()) {
      if (!seen.has(word)) {
        seen.add(word);
        yield word;
      }
    }
  }
}

/**
 * Every word with this pronunciation (exact IPA, NFC), in lexicon order.
 * @param {string} lang
 * @param {string} ipa
 * @returns {string[]}
 */
export function spellingsOf(lang, ipa) {
  checkLang(lang);
  const wanted = String(ipa).normalize('NFC');
  if (callStack.length > 0) {
    return [...lexiconWords(lang)].filter((word) =>
      pronunciations(lang, word).includes(wanted)
    );
  }
  if (!spellingIndex.has(lang)) {
    const index = new Map();
    for (const word of lexiconWords(lang)) {
      for (const value of pronunciations(lang, word)) {
        index.set(value, [...(index.get(value) ?? []), word]);
      }
    }
    spellingIndex.set(lang, index);
  }
  return [...(spellingIndex.get(lang).get(wanted) ?? [])];
}
