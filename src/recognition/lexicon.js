/** Cached trie of the current forward pronunciations, built on first use. */
import { parseIpa } from '../ipa/parse.js';
import { adaptEnglishWord } from '../g2p/accents.js';
import {
  pronunciations,
  lexiconRevision,
  lexiconWords,
  userPronunciations,
} from '../g2p/lexicon.js';
import { hanziToPinyin } from '../g2p/chinese.js';
import { pinyinSyllableToIpa, syllableWithTone } from '../g2p/pinyin.js';
import { hindiUnits, deleteSchwas } from '../g2p/hindi.js';
import { WEAK_FORMS, BEFORE_VOWEL, BEFORE_TO } from '../g2p/weak-forms.js';
import {
  RUSSIAN_PROCLITICS,
  RUSSIAN_ENCLITICS,
} from '../g2p/russian-clitics.js';
import { getCounts } from './data/index.js';
import { checkLanguage, pronounce } from './languages.js';

const cached = new Map();
let readPreparedLexicon;

export function installPreparedLexicons(read) {
  readPreparedLexicon = read;
  cached.clear();
}
const russianAlternate = new Map([
  ['в', 'f'],
  ['к', 'ɡ'],
  ['с', 'z'],
]);

/** Trie keys omit stress but retain diacritics; Mandarin tones stay too. */
export function soundKey(token, language) {
  return (
    token.symbol + (language === 'zh' ? `:${(token.tone ?? []).join('')}` : '')
  );
}

const noChildren = new Map();
const noEntries = [];

export function trieNode(token) {
  return { children: noChildren, entries: noEntries, token };
}

function contextualChinese() {
  const variants = new Map();
  const readings = new Map();
  // A phrase may give a character a neutral reading, e.g.
  // 户 in 窗户. Preserve these readings when the corpus segments that phrase.
  for (const phrase of lexiconWords('zh')) {
    for (const { char, pinyin } of hanziToPinyin(phrase)) {
      if (!pinyin) {
        continue;
      }
      if (!readings.has(pinyin)) {
        readings.set(pinyin, pinyinSyllableToIpa(pinyin));
      }
      const syllable = readings.get(pinyin);
      if (!syllable || syllable.tone !== 5) {
        continue;
      }
      if (!variants.has(char)) {
        variants.set(char, new Set());
      }
      variants.get(char).add(syllableWithTone(syllable, true));
    }
  }
  return variants;
}

function hindiVariants(word) {
  const units = hindiUnits(word);
  const render = (list) =>
    list
      .map((u) =>
        u.nasal
          ? `${u.ipa.replace('ː', '')}̃${u.ipa.includes('ː') ? 'ː' : ''}`
          : u.ipa
      )
      .join('');
  return [render(units), render(deleteSchwas(units))];
}

function extraVariants(word, language) {
  if (language === 'hi') {
    return hindiVariants(word);
  }
  if (language === 'en') {
    return [WEAK_FORMS[word]?.weak, BEFORE_VOWEL[word], BEFORE_TO[word]].filter(
      Boolean
    );
  }
  if (language === 'ru') {
    const variants = [
      ...(RUSSIAN_PROCLITICS[word] ?? []),
      RUSSIAN_ENCLITICS[word],
    ].filter(Boolean);
    const alternate = russianAlternate.get(word);
    return [...variants, ...(alternate ? [alternate] : [])];
  }
  return [];
}

function surfaceVariants(ipa, word, language) {
  if (language === 'en') {
    return [adaptEnglishWord(ipa, word, 'en-US')];
  }
  if (language !== 'zh') {
    return [];
  }
  // Phrase-final full third tones become half-third before another word.
  const forms = [ipa.replaceAll('˨˩˦', '˨˩')];
  if (word === '一') {
    forms.push('i˧˥', 'i˥˩');
  }
  if (word === '不') {
    forms.push(ipa.replace('˥˩', '˧˥'));
  }
  return forms;
}

/** Add one pronunciation, retaining homophones at the same end node. */
export function addPronunciation(root, entry, language, parsed) {
  const tokens =
    parsed ?? parseIpa(entry.ipa).tokens.filter((t) => t.kind !== 'pause');
  if (!tokens.length) {
    return;
  }
  let node = root;
  for (const token of tokens) {
    const key = soundKey(token, language);
    let child = node.children.get(key);
    if (!child) {
      child = trieNode(token);
      if (node.children === noChildren) {
        node.children = new Map();
      }
      node.children.set(key, child);
    }
    node = child;
  }
  if (node.entries === noEntries) {
    node.entries = [];
  }
  if (!node.entries.some((e) => e.word === entry.word && e.ipa === entry.ipa)) {
    node.entries.push({ ...entry, tokens });
  }
}

function* lexiconPronunciations(language, words) {
  const contextual = language === 'zh' ? contextualChinese() : new Map();
  const parsed = new Map();
  for (const { word, count } of words) {
    // The shipped Russian speaker already uses the same forward reading.
    const additional =
      language === 'ru'
        ? (userPronunciations(language, word) ?? [])
        : pronunciations(language, word);
    const variants = new Set([
      pronounce(word, language).ipa,
      ...additional,
      ...extraVariants(word, language),
      ...(contextual.get(word) ?? []),
    ]);
    for (const ipa of [...variants]) {
      for (const surface of surfaceVariants(ipa, word, language)) {
        variants.add(surface);
      }
    }
    for (const ipa of variants) {
      if (!ipa) {
        continue;
      }
      if (!parsed.has(ipa)) {
        parsed.set(
          ipa,
          parseIpa(ipa).tokens.filter((t) => t.kind !== 'pause')
        );
      }
      const tokens = parsed.get(ipa);
      if (tokens.length) {
        yield { word, ipa, count, tokens };
      }
    }
  }
}

/** The same trie object is returned on subsequent calls. */
export function getLexicon(language = 'en') {
  checkLanguage(language);
  if (
    !cached.has(language) ||
    cached.get(language).revision !== lexiconRevision()
  ) {
    const data = getCounts(language);
    let root;
    let prepared;
    cached.set(language, {
      get prepared() {
        return this.revision === 0
          ? (prepared ??= readPreparedLexicon?.(language, data.words) ?? false)
          : false;
      },
      get root() {
        if (this.prepared) {
          return this.prepared.root;
        }
        if (!root) {
          root = trieNode();
          for (const { tokens, ...entry } of this.pronunciations()) {
            addPronunciation(root, entry, language, tokens);
          }
        }
        return root;
      },
      /** Pronunciations of all words, or of the `limit` most frequent. */
      pronunciations(limit = data.words.length) {
        return lexiconPronunciations(language, data.words.slice(0, limit));
      },
      words: data.words,
      counts: data.counts,
      get bigrams() {
        return data.bigrams;
      },
      transitionRow: data.transitionRow,
      total: data.total,
      revision: lexiconRevision(),
    });
  }
  return cached.get(language);
}

/** Explicit cache reset for applications that change the forward lexicons. */
export function clearRecognitionLexicons() {
  cached.clear();
}
