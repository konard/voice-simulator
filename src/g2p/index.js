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
 * Words are pronounced one at a time; then Russian clitics join the word
 * they lean on (see `russian-clitics.js`): a preposition or `не`, `ни`
 * joins the next word (`из дома` ɪz ˈdomə), the particles `же`, `ли`, `бы`
 * join the previous one (`как же` kaɡ ʐɨ). Each written word stays one
 * item of `words`.
 * English function words (`of`, `to`, `can`, `you`, ...) are weak and
 * unstressed inside a phrase and keep their strong form alone and at its
 * end (see `weak-forms.js`).
 */

import { englishWordToIpa } from './english.js';
import { hindiWordToIpa, normalizeDevanagariDigits } from './hindi.js';
import {
  chineseRunToIpa,
  chineseSyllables,
  chineseWordToIpa,
  isPinyin,
} from './chinese.js';
import { russianWordToIpa } from './russian.js';
import { joinRussianClitics } from './russian-clitics.js';
import { normalizeText } from './normalize.js';
import { adaptEnglishWord, hasLinkingR, isNonRhotic } from './accents.js';
import { weakenFunctionWords } from './weak-forms.js';
import { markPhrasing } from './phrasing.js';
import { withLexicon } from './lexicon.js';
import { accentSettings, applyAccentSettings } from '../accent/index.js';
import { isSsml, parseMarkup } from '../markup/index.js';
import { MODE_DEFAULTS, composeMode } from '../markup/modes.js';
import { markupItems, markupModes } from './markup.js';

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

/**
 * Pronounce one word. The `context` (words around it, see
 * `wordContexts()`) lets English choose between the readings of a
 * heteronym; Russian and Chinese take the g2p switches of an accent
 * (`okanye`, `fricativeG`, `erhua`, `lowThird`) with it.
 */
function pronounceWord(word, language, context, g2p) {
  const options = language === 'en' ? context : { ...context, ...g2p };
  const result = WORD_PRONOUNCERS[language](word, options);
  return { text: word, lang: language, ...result };
}

/**
 * Pronounce a normalised word item in its accent: `accent` is the English
 * accent of the English pronouncer and `g2p` the switches of the text's
 * accent for words of `g2pLanguage`.
 */
function pronounceItem(item, source, accent, context, switches) {
  return pronounceSource(item, source, context, switches).map((word) => {
    if (word.lang !== 'en' || !word.ipa || word.sound) {
      return word;
    }
    const ipa = adaptEnglishWord(word.ipa, word.text, accent);
    return { ...word, ipa, linkingR: hasLinkingR(word.ipa) };
  });
}

/** Pronounce a normalised word item, keeping its source range. */
function pronounceSource(item, source, context, switches) {
  const g2p = switches?.language === item.lang ? switches.g2p : {};
  const { sourceStart, sourceEnd, token, partStart, partEnd } = item;
  const original = source.slice(sourceStart, sourceEnd);
  const range = { sourceStart, sourceEnd, original, token };
  if (partStart !== undefined && partEnd !== undefined) {
    Object.assign(range, { partStart, partEnd });
  }
  if (item.ipa) {
    const extra = item.letter ? { letter: true } : {};
    if (item.sound) {
      extra.sound = item.sound;
    }
    return [
      { text: item.text, lang: item.lang, ipa: item.ipa, ...extra, ...range },
    ];
  }
  if (
    item.lang === 'zh' &&
    item.text === original &&
    /\p{Script=Han}/u.test(original)
  ) {
    return splitHanRun(item, range, g2p);
  }
  return [
    {
      ...pronounceWord(item.say ?? item.text, item.lang, context, g2p),
      text: item.text,
      ...range,
    },
  ];
}

/**
 * Split a run of Hanzi into dictionary words, so each can be highlighted
 * on its own; tone sandhi is still applied across the whole run.
 */
function splitHanRun(item, range, g2p) {
  const groups = new Map();
  let offset = item.sourceStart;
  for (const syllable of chineseSyllables(item.text, g2p)) {
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
        source: group.syllables.some((syllable) => syllable.user)
          ? 'user'
          : 'dictionary',
        ...range,
        sourceStart: group.sourceStart,
        sourceEnd: group.sourceEnd,
        original: group.text,
      };
    })
    .filter((word) => word.ipa);
}

/** Whether an item is a Chinese word with known syllables. */
const isChineseWord = (item) =>
  item.lang === 'zh' &&
  typeof item.pinyin === 'string' &&
  item.pinyin.trim() !== '';

/**
 * Apply tone sandhi across the spaces between Chinese words (issue 49):
 * every run of two or more neighbouring Chinese words with pinyin is read
 * as one phrase (`我 很 好` like `我很好`, `wǒ hěn hǎo` like
 * `wo3hen3hao3`). A break, a word of another language or a word without
 * pinyin ends a run. The items keep their text and source range; only
 * their `ipa` changes. Typed pinyin keeps the tone that was typed: 一 and
 * 不 written `yi1` or `bu4` are not changed, as only Hanzi say which
 * syllable is 一 or 不.
 * @param {object[]} items
 * @param {{language: string, g2p: object}|null} [switches] the accent
 *   settings; the `lowThird` switch of a Chinese accent applies to the
 *   whole run (issue 57).
 */
function joinChineseRuns(items, switches) {
  const g2p = switches?.language === 'zh' ? switches.g2p : {};
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const ipa = chineseRunToIpa(run, g2p);
      run.forEach((item, index) => {
        if (ipa) {
          item.ipa = ipa[index];
        }
      });
    }
    run = [];
  };
  for (const item of items) {
    if (!item.break && isChineseWord(item)) {
      run.push(item);
    } else {
      flush();
    }
  }
  flush();
}

/** Lowercased spelling of a normalised word, as context for its neighbours. */
function contextWord(item) {
  return item.text.toLowerCase().replaceAll('’', "'");
}

/**
 * The context of every word item of `normalized`: the words before it
 * (nearest first) and after it in the same clause, and all words of its
 * sentence. A clause ends at any break; a sentence ends at a break whose
 * symbol ends in `.`, `!`, `?` or `…`.
 * @param {object[]} normalized items from `normalizeText()`
 * @returns {({before: string[], after: string[], sentence: string[]}|undefined)[]}
 */
function wordContexts(normalized) {
  const contexts = [];
  // Every context of a sentence shares one array, which is complete once
  // the sentence ends.
  let sentence = [];
  let clause = [];
  const closeClause = () => {
    clause.forEach(({ index }, position) => {
      contexts[index] = {
        before: clause
          .slice(0, position)
          .reverse()
          .map(({ word }) => word),
        after: clause.slice(position + 1).map(({ word }) => word),
        sentence,
      };
    });
    clause = [];
  };
  normalized.forEach((item, index) => {
    if (item.kind !== 'break') {
      const word = contextWord(item);
      clause.push({ index, word });
      sentence.push(word);
      return;
    }
    closeClause();
    if ('.!?…'.includes(item.symbol.at(-1))) {
      sentence = [];
    }
  });
  closeClause();
  return contexts;
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
 * Split a language tag such as `en-GB` into the language (`en`) and the
 * full tag, which then selects the accent unless one is given.
 */
function splitLanguageTag(tag) {
  const requested = tag ?? 'auto';
  const match = /^([a-z]{2})[-_][a-z]{2}$/i.exec(requested);
  if (!match || !WORD_PRONOUNCERS[match[1].toLowerCase()]) {
    return { requested, region: undefined };
  }
  return {
    requested: match[1].toLowerCase(),
    region: requested.replace('_', '-'),
  };
}

/**
 * The accent settings of a text (see accentSettings of
 * src/accent/index.js) and the English accent of its English words. The
 * region of a language tag (`en-NZ`) that is no accent code gives the
 * default accent; an unknown accent code of the language throws a
 * RangeError.
 */
function textAccent(lang, options, region) {
  const value = options.accent ?? region;
  const lenient = options.accent === undefined;
  const settings = accentSettings(lang, value, {
    level: options.accentLevel,
    lenient,
  });
  const english =
    lang === 'en'
      ? settings
      : accentSettings('en', value, {
          level: options.accentLevel,
          lenient: true,
        });
  return { settings, english: english.englishAccent };
}

/** The accent settings of `lang` among those of a text, if any. */
function settingsOf(all, lang) {
  return all.find((settings) => settings.language === lang);
}

/** Apply the rules of an accent to the words of its language. */
function applyAccentRules(items, all) {
  for (const item of items) {
    const settings = settingsOf(all, item.lang);
    if (!item.break && item.ipa && settings) {
      item.ipa = applyAccentSettings(item.ipa, settings);
    }
  }
}

/**
 * Words and breaks of `source` in `lang`, appended to `items`. `offset`
 * moves their source ranges (a stretch of a longer text); `settings` are
 * the accent settings of `lang`.
 */
function transcribe(items, source, lang, accent, settings, offset = 0) {
  const shift = (item) =>
    offset
      ? {
          ...item,
          sourceStart: item.sourceStart + offset,
          ...(item.sourceEnd === undefined
            ? {}
            : { sourceEnd: item.sourceEnd + offset }),
        }
      : item;
  const normalized = normalizeText(source, {
    lang,
    wordLanguage: (word) => wordLanguage(word, lang),
  });
  const contexts = wordContexts(normalized);
  normalized.forEach((item, index) => {
    if (item.kind === 'break') {
      addBreak(items, shift(item));
    } else {
      items.push(
        ...pronounceItem(item, source, accent, contexts[index], settings).map(
          shift
        )
      );
    }
  });
}

/**
 * The passes over all items: Chinese runs, clitics, phrasing (sentence
 * types and phrase breaks, ./phrasing.js), weak forms, linking r and the
 * accent rules. `all` holds the accent settings of the text, the first
 * one of its main language.
 */
function finishItems(items, accent, options, all) {
  // A written sound (`um`, `hahaha`) is no word for these passes: it
  // stands between phrases like a break and keeps its IPA.
  const sounds = items.filter((item) => item.sound && !item.break);
  for (const item of sounds) {
    item.break = true;
  }
  joinChineseRuns(items, settingsOf(all, 'zh'));
  joinRussianClitics(items);
  markPhrasing(items);
  if ((options.weakForms ?? all[0].g2p.weakForms) !== false) {
    weakenFunctionWords(items, accent);
  }
  linkRs(items, accent);
  applyAccentRules(items, all);
  for (const item of sounds) {
    delete item.break;
  }
  numberSounds(items);
}

/**
 * Number the sounds of the IPA (markup sounds and written ones) in
 * order: a written sound gets `soundIndex`, so that the timeline finds
 * its time (src/articulation/timeline.js).
 */
function numberSounds(items) {
  let sound = 0;
  for (const item of items) {
    if (!item.sound) {
      continue;
    }
    if (!item.break) {
      item.soundIndex = sound;
    }
    sound++;
  }
}

/**
 * The language, region and accent settings of a language tag, as
 * `textToIpa()` reads it. `region` stands in for the region of the tag.
 */
function languageOf(tag, source, options, region) {
  const split = splitLanguageTag(tag);
  const { requested } = split;
  const lang =
    requested === 'auto' || !WORD_PRONOUNCERS[requested]
      ? detectLanguage(source)
      : requested;
  const own = region ?? split.region;
  return { lang, region: own, ...textAccent(lang, options, own) };
}

/** Text to IPA with speech markup (see docs/markup.md). */
function markupToIpa(parsed, input, options) {
  const source = normalizeDevanagariDigits(parsed.text);
  const tag =
    options.lang && options.lang !== 'auto'
      ? options.lang
      : (parsed.lang ?? options.lang);
  const base = languageOf(tag, source, options);
  const all = [base.settings];
  const items = markupItems(parsed, source, input, {
    transcribe: (into, text, lang, offset) => {
      const local = lang ? languageOf(lang, text, options, base.region) : base;
      if (!settingsOf(all, local.lang)) {
        all.push(local.settings);
      }
      const { settings } = local;
      transcribe(into, text, local.lang, local.english, settings, offset);
    },
    lang: base.lang,
  });
  finishItems(items, base.english, options, all);
  for (const item of items) {
    // A tune from the phrasing (IK4, IK5) yields to one from the markup.
    if (item.tune && item.mode && !item.mode.tune) {
      item.mode = composeMode(item.mode, { tune: item.tune });
    }
  }
  const { ipa, modes } = markupModes(items, parsed);
  return {
    lang: base.lang,
    accent: base.settings.code,
    accentLevel: base.settings.level,
    ipa,
    words: items.filter((item) => !item.break),
    modes,
    warnings: parsed.warnings,
  };
}

/**
 * Convert text to IPA.
 * @param {string} text
 * @param {{lang?: string, accent?: string|object, accentLevel?: number, weakForms?: boolean, markup?: boolean, head?: {pitch?: number},
 *   lexicon?: Record<string, Record<string, string|string[]>>}} [options]
 *   `lang` is 'auto', 'en', 'ru', 'hi' or 'zh', or a regional tag such as
 *   'en-GB'. `accent` picks an accent of the language (a code of ACCENTS
 *   such as `en-GB`, `en-x-ru` or `zh-TW`, `{code, strength}`, or an accent
 *   definition; see src/accent/) and wins over the region of `lang`; a
 *   code of another language is ignored. `accentLevel` (0 to 1, default 1)
 *   is its strength when the option has none. `weakForms` (default `true`
 *   unless the accent turns them off) speaks English function words in
 *   their weak, unstressed form inside a phrase (`a cup of tea for you`
 *   ə ˈkʌp əv ˈti fɚ ju); `false` keeps every word in its dictionary form.
 *   `markup`: a text that starts with `<speak` is SSML unless `markup` is
 *   `false`; `true` also reads inline tags (`[whisper]…[/whisper]`). See
 *   docs/markup.md.
 *   `lexicon` gives pronunciations for this call only, per language
 *   (`{en: {quinoa: 'kiˈnoʊə'}, zh: {重庆: 'chóng qìng'}}`); they win over
 *   `addLexicon()` and the shipped lexicons and are reported with
 *   `source: 'user'`. An entry that cannot be read (IPA that `parseIpa`
 *   does not know, pinyin with the wrong number of syllables) throws a
 *   TypeError naming the word.
 * @returns {{lang: string, accent: string|null, accentLevel: number, ipa: string, words: object[], modes: {from: number, to: number, mode: object}[], warnings: {position: number, message: string}[]}}
 *   With markup, `ipa` holds the ExtIPA/VoQS marks of the modes that have
 *   one, `modes` are spans in IPA word indexes and every word's
 *   `sourceStart`/`sourceEnd` point into the input. Malformed SSML throws
 *   `MarkupError`.
 */
export function textToIpa(text, options = {}) {
  return withLexicon(options.lexicon, () => readText(text, options));
}

function readText(text, options) {
  const input = String(text ?? '');
  if (options.markup === true || (options.markup !== false && isSsml(input))) {
    return markupToIpa(parseMarkup(input, options), input, options);
  }
  const source = normalizeDevanagariDigits(input);
  const { lang, settings, english } = languageOf(options.lang, source, options);
  const items = [];
  transcribe(items, source, lang, english, settings);
  finishItems(items, english, options, [settings]);
  const tuned = items.some((item) => item.tune);
  if (tuned) {
    // IK4 and IK5 from the phrasing are written as mode spans `{IK4 … IK4}`.
    for (const item of items) {
      item.mode = item.tune
        ? composeMode(MODE_DEFAULTS, { tune: item.tune })
        : MODE_DEFAULTS;
    }
  }
  const { ipa, modes } = tuned
    ? markupModes(items)
    : {
        ipa: items
          .map((item) => item.ipa)
          .filter(Boolean)
          .join(' '),
        modes: [],
      };
  return {
    lang,
    accent: settings.code,
    accentLevel: settings.level,
    ipa,
    words: items.filter((item) => !item.break),
    modes,
    warnings: [],
  };
}
