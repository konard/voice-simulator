/**
 * Weak forms of English function words.
 *
 * Inside a phrase the small grammar words (articles, conjunctions,
 * prepositions, auxiliaries and pronouns) lose their stress and most of
 * them their full vowel: `a cup of tea for you` is ə ˈkʌp əv ˈti fɚ ju.
 * The forms are General American, written with the symbols of
 * the English lexicon (`lexicon/en.js`); `adaptEnglishWord()` turns them into the other
 * accents. Sources: Roach (2009) chapter 12, Cruttenden (2014) section
 * 11.3 and the entries of Wells (2008).
 */

import { adaptEnglishWord, hasLinkingR } from './accents.js';

const table = (kind, pairs) =>
  pairs.split(' ').map((pair) => {
    const [word, weak] = pair.split('=');
    return [word, Object.freeze({ kind, weak })];
  });

/**
 * Weak form and word class of every English function word, by its lower
 * case spelling. `have`, `has`, `had`, `do` and `does` keep their full
 * vowel and only lose the stress: without a parser the main verb (`I have
 * a car`) cannot be told from the auxiliary.
 * @type {Readonly<Record<string, Readonly<{kind: string, weak: string}>>>}
 */
export const WEAK_FORMS = Object.freeze(
  Object.fromEntries([
    ...table('article', 'a=ə an=ən the=ðə'),
    ...table('conjunction', 'and=ənd but=bət or=ɔɹ as=əz than=ðən if=ɪf'),
    ...table(
      'preposition',
      'of=əv to=tə for=fɚ from=fɹəm at=ət in=ɪn on=ɑn with=wɪð by=baɪ'
    ),
    ...table(
      'auxiliary',
      'am=əm is=ɪz are=ɚ was=wəz were=wɚ be=bi been=bɪn have=hæv ' +
        'has=hæz had=hæd do=du does=dʌz can=kən could=kəd will=wəl ' +
        'would=wəd shall=ʃəl should=ʃəd must=məst'
    ),
    ...table(
      'pronoun',
      'i=aɪ you=ju he=hi she=ʃi we=wi they=ðeɪ it=ɪt me=mi him=hɪm ' +
        'her=hɚ us=əs them=ðəm my=maɪ your=jɚ his=hɪz its=ɪts our=ɑɹ ' +
        'their=ðɛɹ'
    ),
  ])
);

/** Forms before a word that starts with a vowel sound. */
export const BEFORE_VOWEL = Object.freeze({ the: 'ði', to: 'tu' });

/** Forms of a word that is followed by `to`. */
export const BEFORE_TO = Object.freeze({
  have: 'ˈhæf',
  has: 'ˈhæs',
  used: 'ˈjus',
  supposed: 'səˈpoʊs',
});

/** After these words an auxiliary is a noun (`a can`, `my will`). */
export const DETERMINERS = new Set(
  'a an the my your his her its our their this that'.split(' ')
);

/** Forms of `be`: after them `used` stays the verb `use` (`is used to`). */
const BE_FORMS = new Set('am is are was were be been being'.split(' '));

/** A vowel at the start of an IPA word, as in `linkRs()`, with ɝ and ɚ. */
const VOWEL_START = /^ˈ?ˌ?[aeiouæɑɒɔəɛɪʊʌɜɝɚ]/u;

const lower = (item) => item?.text.toLowerCase();

/** Whether a function word keeps its strong form between its neighbours. */
function keepsStrong(kind, previous, next) {
  if (kind === 'preposition') {
    return !next;
  }
  if (kind === 'auxiliary') {
    return !next || lower(next) === 'not' || DETERMINERS.has(lower(previous));
  }
  return false;
}

/**
 * The General American form of `item` inside its phrase, or `null` when it
 * keeps the form it has.
 */
function phraseForm(item, previous, next, nextIpa) {
  const word = lower(item);
  if (lower(next) === 'to' && Object.hasOwn(BEFORE_TO, word)) {
    return word === 'used' && BE_FORMS.has(lower(previous))
      ? null
      : BEFORE_TO[word];
  }
  if (!Object.hasOwn(WEAK_FORMS, word)) {
    return null;
  }
  const { kind, weak } = WEAK_FORMS[word];
  if (keepsStrong(kind, previous, next)) {
    return null;
  }
  if (Object.hasOwn(BEFORE_VOWEL, word) && VOWEL_START.test(nextIpa ?? '')) {
    return BEFORE_VOWEL[word];
  }
  return weak;
}

/** Weaken the function words of one phrase (a run of word items). */
function weakenPhrase(phrase, accent) {
  const strong = phrase.map(({ ipa, linkingR }) => ({ ipa, linkingR }));
  const changed = [];
  phrase.forEach((item, index) => {
    if (item.lang !== 'en' || item.letter) {
      return;
    }
    const form = phraseForm(
      item,
      phrase[index - 1],
      phrase[index + 1],
      strong[index + 1]?.ipa
    );
    if (form === null) {
      return;
    }
    // No spelling: the accent overrides by spelling (`of` ɒv in en-GB)
    // are strong forms.
    item.ipa = adaptEnglishWord(form, '', accent);
    item.linkingR = hasLinkingR(form);
    changed.push(index);
  });
  if (changed.length === 0 || phrase.some((item) => item.ipa?.includes('ˈ'))) {
    return;
  }
  // Every phrase keeps one stress: `Is it?` ˈɪz ɪt, `For you.` fɚ ˈju.
  const restore =
    changed.findLast((index) => lower(phrase[index]) !== 'it') ??
    changed.at(-1);
  Object.assign(phrase[restore], strong[restore]);
}

/**
 * Speak English function words in their weak form inside a phrase.
 *
 * A phrase is a run of word items between two breaks (or the ends of the
 * list). A function word keeps its strong form at the end of a phrase
 * when it is a preposition (`What are you looking at?`) or an auxiliary
 * (`Yes, I can.`), when an auxiliary is followed by `not` (`You must not
 * go`) or follows a determiner (`a can of beans`), and when it is a
 * spelled letter. `the` and `to` take ði and tu before a vowel; `have`,
 * `has`, `used` and `supposed` fuse with a following `to` (`have to`
 * ˈhæf tə). A phrase whose every stress was removed gets one back on its
 * last changed word other than `it`, so a single word is never changed.
 *
 * Limits: `that`, `there` and `some` are never weakened (their weak and
 * strong uses need a parser); `used` followed by `to` after a form of
 * `be` is read as the verb `use` (`It is used to make bread`).
 *
 * @param {object[]} items word items and break items (`item.break`) as
 *   built in `textToIpa()`; `item.ipa` and `item.linkingR` change in place.
 * @param {string} accent English accent code, e.g. `en-GB`.
 */
export function weakenFunctionWords(items, accent) {
  let phrase = [];
  for (const item of [...items, { break: true }]) {
    if (!item.break) {
      phrase.push(item);
      continue;
    }
    if (phrase.length > 0) {
      weakenPhrase(phrase, accent);
    }
    phrase = [];
  }
}
