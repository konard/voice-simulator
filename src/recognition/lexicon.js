/** Cached trie of the current forward pronunciations, built on first use. */
import { parseIpa } from '../ipa/parse.js';
import { adaptEnglishWord } from '../g2p/accents.js';
import {
  pronunciations,
  lexiconRevision,
  lexiconWords,
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

/** Trie keys omit stress but retain diacritics; Mandarin tones stay too. */
export function soundKey(token, language) {
  return (
    token.symbol + (language === 'zh' ? `:${(token.tone ?? []).join('')}` : '')
  );
}

export function trieNode() {
  return { children: new Map(), entries: [] };
}

function contextualChinese() {
  const variants = new Map();
  // A phrase may give a character a neutral reading, e.g.
  // 户 in 窗户. Preserve these readings when the corpus segments that phrase.
  for (const phrase of lexiconWords('zh')) {
    for (const { char, pinyin } of hanziToPinyin(phrase)) {
      const syllable = pinyin && pinyinSyllableToIpa(pinyin);
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
    const alternate = new Map([
      ['в', 'f'],
      ['к', 'ɡ'],
      ['с', 'z'],
    ]).get(word);
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
    if (!node.children.has(key)) {
      node.children.set(key, { ...trieNode(), token });
    }
    node = node.children.get(key);
  }
  if (!node.entries.some((e) => e.word === entry.word && e.ipa === entry.ipa)) {
    node.entries.push({ ...entry, tokens });
  }
}

/** The same trie object is returned on subsequent calls. */
export function getLexicon(language = 'en') {
  checkLanguage(language);
  if (
    !cached.has(language) ||
    cached.get(language).revision !== lexiconRevision()
  ) {
    const root = trieNode();
    const data = getCounts(language);
    const contextual = language === 'zh' ? contextualChinese() : new Map();
    const parsed = new Map();
    for (const { word, count } of data.words) {
      const variants = new Set([
        pronounce(word, language).ipa,
        ...pronunciations(language, word),
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
        addPronunciation(root, { word, ipa, count }, language, parsed.get(ipa));
      }
    }
    cached.set(language, { root, ...data, revision: lexiconRevision() });
  }
  return cached.get(language);
}

/** Explicit cache reset for applications that change the forward lexicons. */
export function clearRecognitionLexicons() {
  cached.clear();
}
