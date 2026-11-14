/**
 * Russian clitics: prepositions and particles without a stress of their
 * own, spoken as part of the word they lean on.
 *
 * A proclitic (`в`, `из`, `на`, `не` ...) is read as the first syllables of
 * the next word: its vowel is reduced as in a syllable right before the
 * stressed one or farther from it, and its last consonant takes the
 * voicing of the sound that follows (`из дома` ɪz ˈdomə, `с братом` z ˈbratəm, `на работе`
 * nə rɐˈbotʲə). An enclitic (`же`, `ли`, `бы`) is read as the last
 * syllable of the word before; `же` and `бы` voice its last consonant
 * (`как же` kaɡ ʐɨ). Every written word stays one item, so highlighting
 * does not change.
 *
 * References: Avanesov, R. I. (1984). Русское литературное произношение,
 * 6th edition, sections on prepositions and particles without stress;
 * Jones, D., Ward, D. (1969). The Phonetics of Russian, chapters on vowel
 * reduction and voicing assimilation.
 */

const pairs = (entries) =>
  Object.freeze(
    Object.fromEntries(
      entries.map(([word, near, far]) => [
        word,
        Object.freeze([near, far ?? near]),
      ])
    )
  );

/**
 * Prepositions and particles that lean on the word after them, from the
 * lower-case word to `[near, far]`: `near` is the form right before the
 * stressed syllable of the next word, `far` the form anywhere else. The
 * forms keep the voiced last consonant of the spelling (`ɪz`, `ɐb`).
 * `надо` is not here: it is also the word "need".
 */
export const RUSSIAN_PROCLITICS = pairs([
  ['в', 'v'],
  ['во', 'vɐ', 'və'],
  ['к', 'k'],
  ['ко', 'kɐ', 'kə'],
  ['с', 's'],
  ['со', 'sɐ', 'sə'],
  ['о', 'ɐ'],
  ['об', 'ɐb'],
  ['обо', 'ɐbɐ', 'ɐbə'],
  ['от', 'ɐt'],
  ['ото', 'ɐtɐ', 'ɐtə'],
  ['до', 'dɐ', 'də'],
  ['по', 'pɐ', 'pə'],
  ['под', 'pɐd', 'pəd'],
  ['подо', 'pədɐ', 'pədə'],
  ['над', 'nɐd', 'nəd'],
  ['из', 'ɪz'],
  ['изо', 'ɪzɐ', 'ɪzə'],
  ['за', 'zɐ', 'zə'],
  ['на', 'nɐ', 'nə'],
  ['без', 'bʲɪz'],
  ['для', 'dlʲɪ'],
  ['при', 'prʲɪ'],
  ['про', 'prɐ', 'prə'],
  ['через', 't͡ɕɪrʲɪz'],
  ['перед', 'pʲɪrʲɪd'],
  ['передо', 'pʲɪrʲɪdɐ', 'pʲɪrʲɪdə'],
  ['у', 'ʊ'],
  ['не', 'nʲɪ'],
  ['ни', 'nʲɪ'],
]);

/** Particles that lean on the word before them. */
export const RUSSIAN_ENCLITICS = Object.freeze({
  же: 'ʐɨ',
  ли: 'lʲɪ',
  бы: 'bɨ',
});

/** These particles voice the last consonant of the word before. */
const VOICING_ENCLITICS = new Set(['же', 'бы']);
const DEVOICE = { b: 'p', v: 'f', ɡ: 'k', d: 't', z: 's', ʐ: 'ʂ' };
const VOICE = { p: 'b', f: 'v', k: 'ɡ', t: 'd', s: 'z', ʂ: 'ʐ' };
const VOICELESS_START = /^[pfktsʂxɕ]/u;
const VOICED_START = /^[bɡdzʐ]/u;
const VOWEL = /[aeiouɨəɐɪʊɛɔ]/gu;
const HARD_END = /[^aeiouɨəɐɪʊɛɔʲ]$/u;
const STRESS_MARK = /\+|́/u;

/**
 * Change the voicing of the last consonant of `ipa` by `table`
 * (`DEVOICE` or `VOICE`), keeping a palatal mark `ʲ` after it.
 * @param {string} ipa
 * @param {Record<string, string>} table
 * @returns {string}
 */
export function setFinalVoicing(ipa, table) {
  const mark = ipa.endsWith('ʲ') ? 'ʲ' : '';
  const body = mark ? ipa.slice(0, -1) : ipa;
  const last = body.at(-1);
  return table[last] ? `${body.slice(0, -1)}${table[last]}${mark}` : ipa;
}

/**
 * Whether the item is written as the clitic itself: no stress mark typed
 * by the user (that keeps today's reading), and not a letter of a spelled
 * abbreviation (`США` gives the item `с` read ɛs, whose `original` is the
 * whole abbreviation).
 */
function writtenAsIs(item, word) {
  const original = (item.original ?? item.text).normalize('NFD');
  return !STRESS_MARK.test(original) && original.toLowerCase() === word;
}

function isClitic(item, table) {
  const word = item?.text.toLowerCase();
  return (
    item?.lang === 'ru' && Object.hasOwn(table, word) && writtenAsIs(item, word)
  );
}

const isProclitic = (item) => isClitic(item, RUSSIAN_PROCLITICS);

/** The form of a proclitic before the word `next`. */
function procliticIpa(item, next) {
  const [near, far] = RUSSIAN_PROCLITICS[item.text.toLowerCase()];
  const beforeStress = next.ipa.split('ˈ')[0];
  const pretonic =
    !isProclitic(next) &&
    (!next.ipa.includes('ˈ') || !beforeStress.match(VOWEL));
  const form = pretonic ? near : far;
  const start = next.ipa.replace('ˈ', '');
  if (VOICELESS_START.test(start)) {
    return setFinalVoicing(form, DEVOICE);
  }
  return VOICED_START.test(start) ? setFinalVoicing(form, VOICE) : form;
}

/** Join the clitics of one phrase (word items between two breaks). */
function joinPhrase(phrase) {
  const clitics = new Set();
  for (let index = phrase.length - 1; index >= 0; index--) {
    const item = phrase[index];
    const next = phrase[index + 1];
    const previous = phrase[index - 1];
    if (isProclitic(item) && next?.lang === 'ru') {
      item.ipa = procliticIpa(item, next);
      clitics.add(item);
      if (HARD_END.test(item.ipa) && !clitics.has(next)) {
        // и after a hard consonant is read ы: с Иваном s ɨˈvanəm.
        next.ipa = next.ipa.replace(/^(ˈ?)[iɪ]/u, '$1ɨ');
      }
    } else if (isClitic(item, RUSSIAN_ENCLITICS) && previous?.lang === 'ru') {
      const word = item.text.toLowerCase();
      item.ipa = RUSSIAN_ENCLITICS[word];
      clitics.add(item);
      if (VOICING_ENCLITICS.has(word) && !isProclitic(previous)) {
        previous.ipa = setFinalVoicing(previous.ipa, VOICE);
      }
    }
  }
}

/**
 * Join Russian prepositions and particles to the word they lean on.
 * `items` is the list built in `textToIpa()`: word items and break items
 * (`item.break` is true); `item.ipa` is changed in place. A phrase is a
 * run of word items between two breaks; each phrase is walked from its
 * last word to its first, so a chain (`из-за дома`, `не для меня`) is
 * joined from the host word outwards. A clitic alone, at the end of a
 * phrase (proclitic) or at its start (enclitic), or next to a word of
 * another language is unchanged.
 *
 * Limits:
 * - Stress that moves onto the preposition (`на́ гору`, `за́ город`,
 *   `не́ был`) is not known; the user writes the stress mark, or the
 *   Russian stress lexicon of the roadmap holds the phrase.
 * - The interjection `О` before a word is reduced like the preposition
 *   (`О боже`); write `о́` to keep it.
 * - `t͡s`, `t͡ɕ` and `x` at the end of a word are not voiced before `же`,
 *   `бы`.
 * @param {object[]} items
 */
export function joinRussianClitics(items) {
  let phrase = [];
  for (const item of items) {
    if (item.break) {
      joinPhrase(phrase);
      phrase = [];
    } else {
      phrase.push(item);
    }
  }
  joinPhrase(phrase);
}
