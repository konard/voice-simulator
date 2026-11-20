/**
 * Phrasing of a text: the sentence type of each question, alternative
 * and tag questions, the Russian constructions IK4 and IK5, and phrase
 * breaks in long stretches without punctuation. The marks go into the
 * IPA, where src/articulation/intonation.js reads them:
 *
 * - yes/no question: `?` (a rise);
 * - wh-question: `↘ ?` (a fall). The question word is looked for per
 *   language: Hindi as `questionFalls` of its verbaliser decides, Mandarin
 *   anywhere in the sentence (谁 什么 哪 哪里 怎么 为什么 几 多少, not in a
 *   吗 question), Russian before the first comma (the word also gets `ˈˈ`,
 *   the centre of IK2), English among the first four words with no
 *   auxiliary before it;
 * - echo question (English, the first word is neither an auxiliary nor a
 *   question word: `You are coming?`): `↗ ?`;
 * - alternative question (or, или, या, 还是 between two words): `↗ |`
 *   before the conjunction (`↗ ,` when a comma stands there) and `↘ ?` at
 *   the end: `Tea or coffee?` ˈti ↗ | ˈɔɹ ˈkɑfi ↘ ?;
 * - English tag question (`, <auxiliary>[n't] <pronoun>?`): `↗ ?`;
 * - Russian `?` opening with а and at most three words: IK4 (`{IK4 … IK4}`);
 *   Russian `!` opening with какой, какая, какое, какие, как or сколько:
 *   IK5. The tune is set as `item.tune`; textToIpa() writes it as a mode.
 *
 * A stretch of more than 14 syllables between two breaks gets `|` before
 * the conjunction nearest its middle that leaves at least four syllables
 * on each side, and so on in each half.
 *
 * Out of scope: syntactic parsing, A-not-A questions (去不去), vocatives
 * and commands, which only the markup marks (`{call … call}`,
 * `[tune command]`).
 */

import { syllabifyIpa } from '../ipa/syllables.js';
import { VERBALIZERS } from './normalize.js';
import { ZH_WH_WORDS } from './verbalize-zh.js';

/** Conjunctions before which a long stretch may break, per language. */
export const PHRASE_CONJUNCTIONS = Object.freeze({
  en: Object.freeze('and but or because that which who when if'.split(' ')),
  ru: Object.freeze('и а но что чтобы который когда если'.split(' ')),
  hi: Object.freeze('और लेकिन कि या क्योंकि जब तो'.split(' ')),
  zh: Object.freeze('和 但是 因为 所以 可是 如果'.split(' ')),
});

/** The conjunction of an alternative question, per language. */
export const ALTERNATIVE_CONJUNCTIONS = Object.freeze({
  en: 'or',
  ru: 'или',
  hi: 'या',
  zh: '还是',
});

/** English auxiliaries that open a yes/no question or a question tag. */
export const ENGLISH_AUXILIARIES = Object.freeze(
  'am is are was were do does did have has had can could will would shall should may might must'.split(
    ' '
  )
);

/** A stretch longer than this many syllables gets a phrase break. */
export const MAX_PHRASE_SYLLABLES = 14;
/** Syllables a phrase break leaves at least on each side. */
export const MIN_PHRASE_SYLLABLES = 4;

const AUXILIARIES = new Set(ENGLISH_AUXILIARIES);
const NEGATED = { "won't": 'will', "can't": 'can', "shan't": 'shall' };
const TAG_PRONOUNS = new Set(
  'i you he she it we they there one this that'.split(' ')
);
const IK5_OPENERS = new Set('какой какая какое какие как сколько'.split(' '));

const lower = (item) =>
  String(item.text ?? '')
    .toLowerCase()
    .replace(/[’ʼ]/gu, "'");

/** The auxiliary of an English word (`aren't` are), or null. */
export function englishAuxiliary(word) {
  const text = String(word).toLowerCase().replace(/[’ʼ]/gu, "'");
  const base = NEGATED[text] ?? text.replace(/n't$/u, '');
  return AUXILIARIES.has(base) ? base : null;
}

/**
 * Whether the words from `index` spell `phrase`: one item, or (Mandarin)
 * several items whose texts join to it. Returns the number of items, or 0.
 */
function spells(words, index, phrase, lang) {
  if (lang !== 'zh') {
    return lower(words[index]) === phrase ? 1 : 0;
  }
  let text = '';
  for (let at = index; at < words.length && text.length < phrase.length; at++) {
    text += words[at].text;
    if (text === phrase) {
      return at - index + 1;
    }
  }
  return 0;
}

/** Number of syllables of a word item. */
function syllableCount(item) {
  if (!item.ipa) {
    return 0;
  }
  return syllabifyIpa(item.ipa, { language: item.lang }).flat().length;
}

/** Write `ˈˈ` on a word: double its first primary stress or prefix one. */
export function emphasizedIpa(ipa) {
  if (ipa.includes('ˈˈ')) {
    return ipa;
  }
  return ipa.includes('ˈ') ? ipa.replace('ˈ', 'ˈˈ') : `ˈˈ${ipa}`;
}

/** Whether Mandarin text holds a question word (几 not in 几乎). */
export function hasZhQuestionWord(text) {
  return ZH_WH_WORDS.some((word) => {
    let at = text.indexOf(word);
    while (at >= 0) {
      if (!(word === '几' && text[at + 1] === '乎')) {
        return true;
      }
      at = text.indexOf(word, at + 1);
    }
    return false;
  });
}

/**
 * The question word that makes a question fall, as `{index}` into
 * `words` (index -1 when the language does not place it), or null.
 */
function whWord(words, lang, firstClause) {
  const texts = words.map(lower);
  const verbalizer = VERBALIZERS[lang];
  if (lang === 'hi') {
    return verbalizer.questionFalls(texts) ? { index: -1 } : null;
  }
  if (lang === 'zh') {
    const text = words.map((word) => word.text).join('');
    return hasZhQuestionWord(text) && !text.endsWith('吗')
      ? { index: -1 }
      : null;
  }
  if (lang === 'ru') {
    const index = texts
      .slice(0, firstClause)
      .findIndex((text) => verbalizer.isWhWord(text));
    return index >= 0 ? { index } : null;
  }
  if (lang === 'en') {
    for (const [index, text] of texts.slice(0, 4).entries()) {
      if (verbalizer.isWhWord(text)) {
        return { index };
      }
      if (englishAuxiliary(text)) {
        return null;
      }
    }
    return null;
  }
  const index = texts
    .slice(0, 2)
    .findIndex((text) => verbalizer?.isWhWord(text));
  return index >= 0 ? { index } : null;
}

/** One sentence: its items (with breaks), word items and end break. */
function sentences(items) {
  const list = [];
  let current = [];
  for (const item of items) {
    current.push(item);
    if (item.break && '.!?…'.includes(item.ipa.at(-1))) {
      list.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    list.push(current);
  }
  return list.map((parts) => ({
    parts,
    words: parts.filter((item) => !item.break),
    end: parts.at(-1)?.break ? parts.at(-1) : null,
  }));
}

/**
 * Alternative question: `↗ |` (or `↗` on a comma) before each conjunction
 * that stands between two words, `↘ ?` at the end. Returns the breaks to
 * insert as `[item, break]` pairs, or null when there is no conjunction.
 */
function alternative(sentence, lang) {
  const phrase = ALTERNATIVE_CONJUNCTIONS[lang];
  if (!phrase) {
    return null;
  }
  const { parts, words } = sentence;
  const found = [];
  for (let index = 1; index < words.length; index++) {
    const span = spells(words, index, phrase, lang);
    if (span > 0 && index + span < words.length) {
      found.push(words[index]);
    }
  }
  if (found.length === 0) {
    return null;
  }
  const inserts = [];
  for (const word of found) {
    const before = parts[parts.indexOf(word) - 1];
    if (before?.break) {
      if (!/[↗↘]/u.test(before.ipa)) {
        before.ipa = `↗ ${before.ipa}`;
      }
    } else {
      inserts.push([word, { text: '|', ipa: '↗ |', break: true }]);
    }
    if (lang === 'en') {
      word.strong = true;
      if (!/[ˈˌ]/u.test(word.ipa)) {
        word.ipa = `ˈ${word.ipa}`;
      }
    }
  }
  return inserts;
}

/** English tag question: `, <auxiliary>[n't] <pronoun>?`. */
function isTagQuestion(sentence) {
  const { parts } = sentence;
  const breaks = parts
    .slice(0, -1)
    .map((item, index) => (item.break ? index : -1))
    .filter((index) => index >= 0);
  const last = breaks.at(-1);
  if (last === undefined || !parts[last].ipa.endsWith(',')) {
    return false;
  }
  const tag = parts.slice(last + 1, -1);
  return (
    last > 0 &&
    tag.length === 2 &&
    englishAuxiliary(lower(tag[0])) !== null &&
    TAG_PRONOUNS.has(lower(tag[1]))
  );
}

/** The sentence type of a question; returns the breaks to insert. */
function markQuestion(sentence, lang) {
  const { parts, words, end } = sentence;
  const inserts = alternative(sentence, lang);
  if (inserts) {
    end.ipa = '↘ ?';
    return inserts;
  }
  if (lang === 'en' && isTagQuestion(sentence)) {
    end.ipa = '↗ ?';
    return [];
  }
  if (lang === 'ru' && lower(words[0]) === 'а' && words.length <= 3) {
    for (const word of words) {
      word.tune = 'IK4';
    }
    return [];
  }
  const comma = parts.findIndex((item) => item.break && item !== end);
  const firstClause = comma < 0 ? words.length : parts.slice(0, comma).length;
  const wh = whWord(words, lang, firstClause);
  if (wh) {
    end.ipa = '↘ ?';
    if (lang === 'ru') {
      words[wh.index].ipa = emphasizedIpa(words[wh.index].ipa);
    }
    return [];
  }
  if (lang === 'en' && !englishAuxiliary(lower(words[0]))) {
    end.ipa = '↗ ?';
  }
  return [];
}

/** Russian exclamation opening with какой, как, сколько: IK5. */
function markExclamation(sentence, lang) {
  const { words } = sentence;
  if (lang === 'ru' && IK5_OPENERS.has(lower(words[0]))) {
    for (const word of words) {
      word.tune = 'IK5';
    }
  }
}

/**
 * Breaks for a stretch of word items: `|` before the conjunction nearest
 * the middle of a stretch longer than MAX_PHRASE_SYLLABLES, recursively.
 */
function stretchBreaks(stretch, counts, inserts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= MAX_PHRASE_SYLLABLES) {
    return;
  }
  let best = -1;
  let bestDistance = Infinity;
  let before = 0;
  for (let index = 0; index < stretch.length; index++) {
    const lang = stretch[index].lang;
    const conjunction = (PHRASE_CONJUNCTIONS[lang] ?? []).some(
      (word) => spells(stretch, index, word, lang) > 0
    );
    const after = total - before;
    if (
      conjunction &&
      before >= MIN_PHRASE_SYLLABLES &&
      after >= MIN_PHRASE_SYLLABLES &&
      Math.abs(before - total / 2) < bestDistance
    ) {
      best = index;
      bestDistance = Math.abs(before - total / 2);
    }
    before += counts[index];
  }
  if (best < 0) {
    return;
  }
  inserts.push([stretch[best], { text: '|', ipa: '|', break: true }]);
  stretchBreaks(stretch.slice(0, best), counts.slice(0, best), inserts);
  stretchBreaks(stretch.slice(best), counts.slice(best), inserts);
}

/** Phrase breaks for every stretch of words between two breaks. */
function phraseBreaks(items) {
  const inserts = [];
  let stretch = [];
  for (const item of [...items, { break: true }]) {
    if (!item.break) {
      stretch.push(item);
      continue;
    }
    if (stretch.length > 1) {
      stretchBreaks(stretch, stretch.map(syllableCount), inserts);
    }
    stretch = [];
  }
  return inserts;
}

/** Insert each `[item, break]` pair: the break goes before the item. */
function insertBreaks(items, inserts) {
  if (inserts.length === 0) {
    return;
  }
  const before = new Map(inserts);
  const result = items.flatMap((item) =>
    before.has(item) ? [before.get(item), item] : [item]
  );
  items.splice(0, items.length, ...result);
}

/**
 * Mark the sentence types and phrase breaks of a list of g2p items (in
 * place): the question marks get their contour (`↘ ?`, `↗ ?`), alternative
 * questions and long stretches get `|` breaks, and the words of IK4 and
 * IK5 sentences get `tune`. Alternative conjunctions get `strong` (weak
 * forms leave them alone).
 * @param {object[]} items g2p items: words `{text, ipa, lang}` and breaks
 *   `{ipa, break: true}`.
 */
export function markPhrasing(items) {
  const inserts = [];
  for (const sentence of sentences(items)) {
    const { words, end } = sentence;
    if (!end || words.length === 0) {
      continue;
    }
    const lang = words[0].lang;
    if (end.ipa === '?') {
      inserts.push(...markQuestion(sentence, lang));
    } else if (end.ipa === '!') {
      markExclamation(sentence, lang);
    }
  }
  insertBreaks(items, inserts);
  insertBreaks(items, phraseBreaks(items));
}
