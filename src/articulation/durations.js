/**
 * Rule-based segment durations per language (issue 39).
 *
 * The model of Klatt (1979; Allen, Hunnicutt and Klatt 1987, chapter 9;
 * Klatt 1987, table II): every sound has an inherent and a minimum
 * duration, and every rule that applies to it multiplies a percentage
 * that stretches the part above the minimum:
 *
 *     duration = (minimum + (inherent - minimum) * percent / 100) / speechRate
 *
 * `percent` starts at 100. The speech rate does not divide both parts
 * alike: the minimum shrinks with `speechRate ** RATE_MINIMUM` and the
 * stretchable part with `speechRate ** RATE_STRETCH`, so a faster voice
 * cuts the long sounds most (Gay 1981, cited in issue 39). Nothing gets
 * shorter than its minimum at the speech rate.
 *
 * `durationFeatures()` describes the context of one token (stress,
 * position in the syllable, word and phrase, neighbours, tone),
 * `DURATION_RULES` lists the rules and `DURATION_TABLES` holds the inherent
 * and minimum durations per class of sound (with per-symbol entries) and
 * the rules each language switches off or weights differently. Numbers
 * marked "fitted" come from experiments/issue-11-fit-durations.mjs, which
 * aligns the golden recordings to the plan and fits the tables.
 */

import { BOUNDARIES, boundaryOf, finalLengthening } from './prosody.js';
import { syllabifyTokens } from '../ipa/syllables.js';

/** Exponent of the speech rate on the minimum duration (issue 39). */
export const RATE_MINIMUM = 0.5;
/** Exponent of the speech rate on the stretchable part (issue 39). */
export const RATE_STRETCH = 1.2;
/**
 * Exponent of the speech rate on pauses at phrase boundaries (strength 2
 * and more): fast speech drops pauses first (issue 39).
 */
export const RATE_PAUSE = 1.5;

const GLIDES = new Set(['j', 'w', 'ɥ', 'ɰ', 'ʋ']);
/** Lax and reduced vowels (the class `reduced`). */
const REDUCED = new Set(['ə', 'ɐ', 'ɪ', 'ʊ', 'ɚ', 'ʏ']);
/** Heights of the vowel chart at or below which a vowel counts as open. */
const OPEN_HEIGHT = 0.2;
/** Heights at or above which a vowel counts as close. */
const CLOSE_HEIGHT = 0.95;

/** Whether a token is a syllable nucleus (vowel or syllabic consonant). */
export function isNucleus(token) {
  return token?.kind === 'vowel' || Boolean(token?.syllabic);
}

/**
 * Class of a consonant for the tables and for the neighbour features.
 * @param {object} token
 * @returns {string}
 */
function consonantClass(token) {
  const { phoneme } = token;
  const voiced = token.voiced ?? phoneme.voiced;
  if (token.affricate) {
    return voiced ? 'voicedPlosive' : 'voicelessPlosive';
  }
  if (phoneme.place === 'glottal' && phoneme.manner !== 'plosive') {
    return 'h';
  }
  switch (phoneme.manner) {
    case 'plosive':
      return voiced ? 'voicedPlosive' : 'voicelessPlosive';
    case 'fricative':
    case 'lateral-fricative':
      return voiced ? 'voicedFricative' : 'voicelessFricative';
    case 'nasal':
      return 'nasal';
    case 'tap':
      return 'tap';
    case 'trill':
      return 'trill';
    default:
      return GLIDES.has(token.base) ? 'glide' : 'liquid';
  }
}

/** Class of a vowel by its height and the reduced set. */
function vowelClass(token) {
  if (REDUCED.has(token.base)) {
    return 'reduced';
  }
  const height = token.phoneme?.height ?? 0.5;
  if (height <= OPEN_HEIGHT) {
    return 'open';
  }
  return height >= CLOSE_HEIGHT ? 'close' : 'mid';
}

/**
 * Class of a neighbouring sound: `vowel`, `voicedPlosive`,
 * `voicelessPlosive`, `voicedFricative`, `voicelessFricative`, `nasal`,
 * `liquid`, `glide`, or null when there is none inside the word.
 * @param {object|undefined} token
 * @returns {string|null}
 */
export function neighbourClass(token) {
  if (!token || token.kind === 'pause') {
    return null;
  }
  if (isNucleus(token)) {
    return 'vowel';
  }
  if (!token.phoneme) {
    return null;
  }
  const name = consonantClass(token);
  if (name === 'h') {
    return 'voicelessFricative';
  }
  if (name === 'tap' || name === 'trill') {
    return 'liquid';
  }
  return name;
}

/**
 * Number of a Chao tone contour in the Mandarin scheme: 1 high level, 2
 * rising, 3 low (dipping or low falling), 4 high falling; 5 is a toneless
 * syllable in tonal text and 0 no tone at all.
 * @param {number[]|null} tone
 * @param {boolean} tonal Whether the text carries tones.
 */
export function toneNumber(tone, tonal) {
  if (!tone?.length) {
    return tonal ? 5 : 0;
  }
  const first = tone[0];
  const last = tone.at(-1);
  const low = Math.min(...tone);
  if (tone.length > 2 && low < first && low < last) {
    return 3;
  }
  if (last > first) {
    return 2;
  }
  if (last < first) {
    return first >= 4 ? 4 : 3;
  }
  return first >= 3 ? 1 : 3;
}

/** Whether a token is a voiceless oral (non-glottal) plosive. */
function voicelessStop(token) {
  return (
    Boolean(token?.phoneme) &&
    !token.voiced &&
    !token.affricate &&
    token.phoneme.manner === 'plosive' &&
    token.phoneme.place !== 'glottal'
  );
}

/** English voiceless stops are aspirated word-initially and before stress. */
export function isAspirated(tokens, index, language) {
  const token = tokens[index];
  if (token?.aspirated) {
    return true;
  }
  if (token?.unaspirated) {
    return false;
  }
  if (!String(language ?? '').startsWith('en') || !voicelessStop(token)) {
    return false;
  }
  const next = tokens[index + 1];
  if (next?.kind !== 'vowel' || next.word !== token.word) {
    return false;
  }
  const previous = tokens[index - 1];
  const wordInitial = !previous || previous.word !== token.word;
  return wordInitial || next.stress === 1;
}

/** The boundary class ending the phrase if no nucleus follows, else null. */
function phraseEnd(tokens, index) {
  for (let next = index + 1; next < tokens.length; next++) {
    const token = tokens[next];
    if (token.kind === 'pause' && token.strength >= 2) {
      return boundaryOf(token);
    }
    if (isNucleus(token)) {
      return null;
    }
  }
  return 'period';
}

/** Words of the token list as arrays of token indices. */
function wordsOf(tokens) {
  const words = [];
  let current = null;
  tokens.forEach((token, index) => {
    if (token.kind === 'pause') {
      current = null;
      return;
    }
    if (!current || tokens[current.at(-1)].word !== token.word) {
      current = [];
      words.push(current);
    }
    current.push(index);
  });
  return words;
}

/** Syllables of one word: token indices, nucleus range and stress. */
function wordSyllables(tokens, indices, language) {
  const position = new Map(indices.map((index) => [tokens[index], index]));
  const syllables = syllabifyTokens(
    indices.map((index) => tokens[index]),
    { language }
  ).map((members) => members.map((token) => position.get(token)));
  return syllables.map((members) => {
    const nuclei = members.filter((index) => isNucleus(tokens[index]));
    const stress = Math.max(0, ...members.map((i) => tokens[i].stress ?? 0));
    const tone = nuclei.map((i) => tokens[i].tone).find(Boolean) ?? null;
    return { members, nuclei, stress, tone };
  });
}

const ANALYSES = new WeakMap();

/** Per-token syllable analysis of a token list (cached per list). */
function analyse(tokens, language) {
  const key = String(language ?? '');
  const cached = ANALYSES.get(tokens);
  if (cached?.key === key) {
    return cached.entries;
  }
  const tonal = tokens.some((token) => token.tone?.length);
  const entries = new Array(tokens.length).fill(null);
  for (const indices of wordsOf(tokens)) {
    const syllables = wordSyllables(tokens, indices, language);
    const stressedAt = syllables.findIndex((syllable) => syllable.stress >= 1);
    syllables.forEach((syllable, number) => {
      const last = syllable.nuclei.at(-1) ?? syllable.members.at(-1);
      const phraseFinal = phraseEnd(tokens, last);
      const first = syllable.nuclei[0] ?? last;
      for (const index of syllable.members) {
        entries[index] = {
          word: indices,
          syllables,
          syllable,
          number,
          phraseFinal,
          pretonic: stressedAt > 0 && number === stressedAt - 1,
          nucleusFirst: first,
          nucleusLast: last,
          tonal,
        };
      }
    });
  }
  ANALYSES.set(tokens, { key, entries });
  return entries;
}

/**
 * Context of the token at `index` for the duration rules.
 * @param {object[]} tokens Tokens from parseIpa.
 * @param {number} index
 * @param {{language?: string}} [options]
 * @returns {object} `stress` (0, 1, 2), `emphasis`, `phraseFinal`
 *   (boundary class or null), `wordFinalSyllable`, `wordInitialSyllable`,
 *   `syllablesInWord`,
 *   `wordInitial`, `syllableOnset`, `syllableCoda`, `pretonic`,
 *   `previous` and `next` (class of the neighbouring sound inside the
 *   word, outside the nucleus for vowels), `tone` (0 to 5),
 *   `afterAspirated`, `nucleusSize` and `nucleusMain` (whether the token
 *   carries the nucleus of a diphthong).
 */
export function durationFeatures(tokens, index, options = {}) {
  const token = tokens[index];
  const entry = analyse(tokens, options.language)[index];
  if (!token || !entry) {
    return null;
  }
  const { syllables, syllable, number } = entry;
  const nucleus = isNucleus(token);
  const { previousIndex, nextIndex } = neighbours(entry, index, nucleus);
  const syllableOnset =
    !nucleus && syllable.nuclei.length > 0 && index < syllable.nuclei[0];
  return {
    stress: syllable.stress,
    emphasis: Boolean(token.emphasis),
    phraseFinal: entry.phraseFinal,
    wordFinalSyllable: number === syllables.length - 1,
    wordInitialSyllable: number === 0,
    syllablesInWord: syllables.length,
    wordInitial: entry.word[0] === index,
    syllableOnset,
    syllableCoda: !nucleus && !syllableOnset,
    pretonic: entry.pretonic,
    previous: neighbourClass(tokens[previousIndex]),
    next: neighbourClass(tokens[nextIndex]),
    tone: toneNumber(syllable.tone, entry.tonal),
    afterAspirated:
      nucleus &&
      previousIndex >= 0 &&
      isAspirated(tokens, previousIndex, options.language),
    ...nucleusFeatures(tokens, entry, index, nucleus),
  };
}

/**
 * Token indices of the sounds before and after a token inside its word
 * (-1 for none); a vowel looks past the other vowels of its nucleus.
 */
function neighbours(entry, index, nucleus) {
  const { word } = entry;
  const first = nucleus ? entry.nucleusFirst : index;
  const last = nucleus ? entry.nucleusLast : index;
  const before = word.indexOf(first) - 1;
  const after = word.indexOf(last) + 1;
  return {
    previousIndex: before >= 0 ? word[before] : -1,
    nextIndex: after < word.length ? word[after] : -1,
  };
}

/**
 * Size of the nucleus of a vowel, whether it is the main vowel (the tone
 * carrier in tonal text, else the first) and the symbols of the nucleus.
 */
function nucleusFeatures(tokens, entry, index, nucleus) {
  if (!nucleus) {
    return { nucleusSize: 0, nucleusMain: false, nucleusSymbol: null };
  }
  const { nuclei } = entry.syllable;
  const carrier = nuclei.find((i) => tokens[i].tone?.length);
  const main = entry.tonal ? (carrier ?? nuclei.at(-1)) : nuclei[0];
  return {
    nucleusSize: nuclei.length,
    nucleusMain: index === main,
    nucleusSymbol: nuclei.map((i) => tokens[i].base).join(''),
  };
}

const vowel = (token) => isNucleus(token);
const consonant = (token) => !isNucleus(token);
const unstressed = (features) => features.stress === 0;
const toneRule = (number) => (token, features) =>
  vowel(token) && features.tone === number;
const before =
  (...classes) =>
  (token, features) =>
    vowel(token) && classes.includes(features.next);

/**
 * The duration rules. `factor` multiplies the percentage (`scope`
 * `percent`, the default), the minimum (`minimum`), the whole duration
 * (`total`) or is milliseconds added after the formula (`add`). Rules of a
 * `group` exclude each other: the first one that applies and is switched
 * on wins. `postvocalic` rules weigh `0.7 + 0.3 * factor` outside a
 * phrase-final syllable; `stress` rules are divided by
 * `stressLengthening / 1.35`; `clauseFinal` scales with the head's
 * `finalLengthening` and with the boundary. A `null` factor switches a rule
 * off; the tables override factors per language.
 *
 * Values: Klatt (1979) as given in Allen, Hunnicutt and Klatt (1987,
 * chapter 9), the starting values of issue 39, and the factors of
 * experiments/issue-11-fit-durations.mjs (`DURATION_TABLES`).
 */
export const DURATION_RULES = Object.freeze(
  [
    {
      // Klatt rule 2: the syllable before a pause, 1.4 (Klatt 1979). A
      // neutral-tone syllable stays short at the end of a phrase too (Chao
      // 1968, section 1.3.5).
      name: 'clauseFinal',
      factor: 1.4,
      applies: (token, features) =>
        Boolean(features.phraseFinal) &&
        !features.syllableOnset &&
        features.tone !== 5,
    },
    {
      // Klatt rule 3: vowels outside a phrase-final syllable, 0.6.
      name: 'nonPhraseFinal',
      factor: 0.6,
      applies: (token, features) => vowel(token) && !features.phraseFinal,
    },
    {
      // Klatt rule 4: vowels outside a word-final syllable, 0.85.
      name: 'nonWordFinal',
      factor: 0.85,
      applies: (token, features) => vowel(token) && !features.wordFinalSyllable,
    },
    {
      // Klatt rule 5: vowels of a word of two or more syllables, 0.8,
      // raised to log2(syllables) so that a third syllable shortens again
      // (stick > sticky > stickiness, Lehiste 1972).
      name: 'polysyllabic',
      factor: 0.8,
      exponent: (features) => Math.log2(features.syllablesInWord),
      applies: (token, features) =>
        vowel(token) && features.syllablesInWord > 1,
    },
    {
      // Klatt rule 6: consonants that do not start the word, 0.85.
      name: 'nonInitialConsonant',
      factor: 0.85,
      applies: (token, features) => consonant(token) && !features.wordInitial,
    },
    {
      // Russian vowel reduction: the syllable just before the stress keeps
      // more length than the others (Bondarko 1977). Off by default.
      name: 'pretonic',
      factor: null,
      group: 'unstressed',
      stress: true,
      applies: (token, features) =>
        vowel(token) && unstressed(features) && features.pretonic,
    },
    {
      // Klatt rule 7: unstressed vowels in a word-medial syllable, 0.5.
      name: 'unstressedMedial',
      factor: 0.5,
      group: 'unstressed',
      stress: true,
      applies: (token, features) =>
        vowel(token) &&
        unstressed(features) &&
        !features.wordFinalSyllable &&
        !features.wordInitialSyllable,
    },
    {
      // Klatt rule 7: other unstressed vowels, 0.7.
      name: 'unstressedOther',
      factor: 0.7,
      group: 'unstressed',
      stress: true,
      applies: (token, features) => vowel(token) && unstressed(features),
    },
    {
      // Klatt rule 7: consonants before an unstressed vowel, 0.7.
      name: 'unstressedOnset',
      factor: 0.7,
      stress: true,
      applies: (token, features) =>
        consonant(token) && features.syllableOnset && unstressed(features),
    },
    {
      // Klatt rule 7: unstressed sounds are more compressible, minimum
      // halved.
      name: 'unstressedMinimum',
      factor: 0.5,
      scope: 'minimum',
      applies: (token, features) => unstressed(features),
    },
    {
      // Klatt rule 8: emphasized vowels, 1.4.
      name: 'emphasis',
      factor: 1.4,
      applies: (token, features) => vowel(token) && features.emphasis,
    },
    {
      // Klatt rule 9: vowel before a voiced fricative, 1.6.
      name: 'beforeVoicedFricative',
      factor: 1.6,
      postvocalic: true,
      applies: before('voicedFricative'),
    },
    {
      // Klatt rule 9: vowel before a voiced plosive, 1.2.
      name: 'beforeVoicedPlosive',
      factor: 1.2,
      postvocalic: true,
      applies: before('voicedPlosive'),
    },
    {
      // Klatt rule 9: vowel before a nasal, 0.85.
      name: 'beforeNasal',
      factor: 0.85,
      postvocalic: true,
      applies: before('nasal'),
    },
    {
      // Klatt rule 9: vowel before a voiceless plosive or fricative, 0.7.
      name: 'beforeVoiceless',
      factor: 0.7,
      postvocalic: true,
      applies: before('voicelessPlosive', 'voicelessFricative'),
    },
    {
      // Klatt rule 9: a word-final vowel without a consonant after it, 1.2
      // (not for the neutral tone, see clauseFinal).
      name: 'openFinal',
      factor: 1.2,
      postvocalic: true,
      applies: (token, features) =>
        vowel(token) &&
        features.wordFinalSyllable &&
        features.next === null &&
        features.tone !== 5,
    },
    {
      // Klatt rule 10: vowel followed by a vowel, 1.2.
      name: 'vowelBeforeVowel',
      factor: 1.2,
      applies: before('vowel'),
    },
    {
      // Klatt rule 10: vowel after a vowel, 0.7.
      name: 'vowelAfterVowel',
      factor: 0.7,
      applies: (token, features) =>
        vowel(token) && features.previous === 'vowel',
    },
    {
      // Klatt rule 10: consonant between two consonants, 0.5.
      name: 'clusterMiddle',
      factor: 0.5,
      group: 'cluster',
      applies: (token, features) =>
        consonant(token) &&
        isConsonantClass(features.previous) &&
        isConsonantClass(features.next),
    },
    {
      // Klatt rule 10: consonant next to one consonant, 0.7.
      name: 'clusterEdge',
      factor: 0.7,
      group: 'cluster',
      applies: (token, features) =>
        consonant(token) &&
        (isConsonantClass(features.previous) ||
          isConsonantClass(features.next)),
    },
    {
      // Klatt rule 11: a stressed vowel after an aspirated plosive gets
      // 25 ms after the formula.
      name: 'aspiration',
      factor: 25,
      scope: 'add',
      applies: (token, features) =>
        vowel(token) && features.stress >= 1 && features.afterAspirated,
    },
    // Mandarin tones (off by default, see the zh table).
    { name: 'tone1', factor: null, applies: toneRule(1) },
    { name: 'tone2', factor: null, applies: toneRule(2) },
    { name: 'tone3', factor: null, applies: toneRule(3) },
    { name: 'tone4', factor: null, applies: toneRule(4) },
    // The neutral tone shortens the whole vowel, minimum included: its
    // syllables are about half as long as full-tone ones (Lin and Yan
    // 1980).
    { name: 'tone5', factor: null, scope: 'total', applies: toneRule(5) },
    {
      // Long vowels written with `ː` that have no class of their own: 1.7,
      // the factor of the plan before issue 39.
      name: 'longVowel',
      factor: 1.7,
      scope: 'total',
      applies: (token) => vowel(token) && token.long,
    },
    {
      // Long (geminate) consonants: 1.8, the factor of the plan before
      // issue 39.
      name: 'longConsonant',
      factor: 1.8,
      scope: 'total',
      applies: (token) => consonant(token) && token.long,
    },
  ].map((rule) => Object.freeze(rule))
);

function isConsonantClass(name) {
  return Boolean(name) && name !== 'vowel';
}

const entry = (inherent, minimum) => Object.freeze({ inherent, minimum });

/**
 * Starting classes of issue 39 (after Klatt 1979; Allen, Hunnicutt and
 * Klatt 1987): inherent and minimum durations in milliseconds.
 */
const START_CLASSES = Object.freeze({
  open: entry(230, 80), // Klatt 1979 [æ ɑ], issue 39
  mid: entry(190, 70), // issue 39
  close: entry(150, 50), // issue 39
  reduced: entry(130, 45), // lax and reduced vowels, issue 39
  diphthong: entry(250, 100), // issue 39
  voicelessFricative: entry(115, 60), // issue 39
  voicedFricative: entry(70, 40), // issue 39
  voicelessPlosive: entry(80, 50), // closure, issue 39
  voicedPlosive: entry(75, 50), // issue 39
  nasal: entry(70, 50), // issue 39
  liquid: entry(80, 35), // issue 39
  glide: entry(70, 40), // issue 39
  h: entry(80, 20), // issue 39
  tap: entry(28, 20), // issue 39
  trill: entry(85, 50), // issue 39
});

/** Language table from overrides of a base table. */
function table(base, overrides = {}) {
  return Object.freeze({
    classes: Object.freeze({ ...base.classes, ...overrides.classes }),
    symbols: Object.freeze({ ...base.symbols, ...overrides.symbols }),
    rules: Object.freeze({ ...base.rules, ...overrides.rules }),
    // Share of the main vowel of a diphthong: weight 1.5 against 1 for
    // each other vowel, i.e. 0.6 and 0.4 (the 0.6 offglide factor of the
    // plan before issue 39).
    diphthongMain: overrides.diphthongMain ?? base.diphthongMain,
    // Affricates: closure from the plosive entry, frication from the
    // fricative entry, each x0.7 (issue 39).
    affricate: Object.freeze({ ...base.affricate, ...overrides.affricate }),
  });
}

// The starting values of issue 39, the base of every language.
const START = table({
  classes: START_CLASSES,
  symbols: {},
  rules: {
    // Klatt's rule 3 shortens every vowel outside a syntactic phrase end to
    // 0.6, but the text analysis knows only punctuation, so the word ends
    // inside a clause that Klatt would call phrase-final get it too. With
    // 0.6 the last vowel before a full stop came out 2.0 times its length
    // at the end of a word inside the clause, against the 1.4 of the
    // head's `finalLengthening` and the 1.2 to 1.6 of issue 39; 0.9 gives
    // 1.55 (experiments/issue-39-phrase-final.mjs). The fit keeps it.
    nonPhraseFinal: 0.9,
  },
  diphthongMain: 1.5,
  affricate: { closure: 0.7, frication: 0.7 },
});

const ENGLISH = table(START, {
  classes: {
    reduced: entry(107, 45), // fitted, issue-11-fit-durations (start 130)
    diphthong: entry(200, 100), // fitted, issue-11-fit-durations (start 250)
    voicelessPlosive: entry(102, 50), // fitted, issue-11-fit-durations (start 80)
  },
});

/**
 * Inherent and minimum durations (ms) per class of sound and per IPA
 * symbol, and the rule factors (null switches a rule off) of each
 * language. `default` is English.
 */
export const DURATION_TABLES = Object.freeze({
  en: ENGLISH,
  ru: table(START, {
    classes: {
      mid: entry(159, 70), // fitted, issue-11-fit-durations (start 190)
      // Long because the 0.45 and 0.7 of the reduction apply to almost
      // every one of them; fitted, issue-11-fit-durations (start 130).
      reduced: entry(187, 45),
      voicelessPlosive: entry(89, 50), // fitted, issue-11-fit-durations (start 80)
    },
    rules: {
      // Russian vowel length does not depend on the voicing of the next
      // consonant at the end of a word (final devoicing), issue 39.
      beforeVoicedFricative: null,
      beforeVoicedPlosive: null,
      // Two degrees of reduction: 0.7 just before the stress, 0.45 in the
      // other unstressed syllables (issue 39; Bondarko 1977).
      pretonic: 0.7,
      unstressedMedial: 0.45,
      unstressedOther: 0.45,
      // Long consonants ([ɕː ʂː]): x1.5, issue 39.
      longConsonant: 1.5,
    },
  }),
  hi: table(START, {
    classes: {
      // Long vowels (written with ː): 210/90 ms, issue 39. The fit asks
      // for 160 to 170 ms (issue-11-fit-durations), which makes [aː] only
      // 1.4 times [ə] against the 1.6 to 2.4 of the test of issue 39; the
      // alignment copies much of the length of the plan it rendered, so
      // the contrast keeps the starting value.
      long: entry(210, 90),
    },
    symbols: {
      // Short [ə ɪ ʊ]: 110/50 ms, issue 39; the inherent duration of [ə]
      // fitted, issue-11-fit-durations.
      ə: entry(114, 50),
      ɪ: entry(110, 50),
      ʊ: entry(110, 50),
    },
    rules: {
      // Hindi stress is weak: unstressed sounds lose little, issue 39.
      unstressedMedial: 0.9,
      unstressedOther: 0.8, // fitted, issue-11-fit-durations (start 0.9)
      unstressedOnset: 0.9,
      // Double consonants: x1.8, issue 39.
      longConsonant: 1.8,
      // Long vowels have their own class.
      longVowel: null,
    },
  }),
  zh: table(START, {
    classes: {
      close: entry(132, 50), // fitted, issue-11-fit-durations (start 150)
      diphthong: entry(229, 100), // fitted, issue-11-fit-durations (start 250)
      nasal: entry(96, 50), // fitted, issue-11-fit-durations (start 70)
    },
    rules: {
      // No lexical stress in the transcriptions: no stress rules and no
      // polysyllabic shortening (issue 39).
      unstressedMedial: null,
      unstressedOther: null,
      unstressedOnset: null,
      unstressedMinimum: null,
      polysyllabic: null,
      // Tone factors, issue 39 (after Xu 1997 and Lin and Yan 1980).
      tone1: 1,
      tone2: 1.05,
      tone3: 1.15,
      tone4: 0.9,
      tone5: 0.55,
      // Weaker final lengthening, issue 39.
      clauseFinal: 1.2,
    },
  }),
  default: ENGLISH,
});

/**
 * The table of a language code (`en-US` finds `en`); `default` otherwise.
 * @param {string} [language]
 */
export function durationTable(language) {
  const code = String(language ?? '')
    .slice(0, 2)
    .toLowerCase();
  return DURATION_TABLES[code] ?? DURATION_TABLES.default;
}

/** Class of a token in `table`. */
export function durationClass(token, features, table) {
  if (!isNucleus(token)) {
    return token.syllabic ? 'reduced' : consonantClass(token);
  }
  if (token.kind !== 'vowel') {
    return 'reduced';
  }
  if (features?.nucleusSize > 1) {
    return 'diphthong';
  }
  if (token.long && table.classes.long) {
    return 'long';
  }
  return vowelClass(token);
}

function scaleEntry(value, share) {
  return { inherent: value.inherent * share, minimum: value.minimum * share };
}

/**
 * Inherent and minimum duration (ms) of each part of a token: one part,
 * or closure and frication of an affricate. A vowel of a diphthong gets
 * its share of the nucleus.
 * @param {object} token
 * @param {object} features From `durationFeatures()`.
 * @param {object} [table]
 * @returns {{inherent: number, minimum: number}[]}
 */
export function phonemeDurations(token, features, table = ENGLISH) {
  const lookup = (name, symbol) =>
    (symbol && table.symbols[symbol]) ?? table.classes[name];
  if (token.affricate) {
    const voiced = token.voiced ?? token.phoneme.voiced;
    const closure = lookup(
      voiced ? 'voicedPlosive' : 'voicelessPlosive',
      token.affricate.stop
    );
    const frication = lookup(
      voiced ? 'voicedFricative' : 'voicelessFricative',
      token.phoneme.symbol
    );
    return [
      scaleEntry(closure, table.affricate.closure),
      scaleEntry(frication, table.affricate.frication),
    ];
  }
  const name = durationClass(token, features, table);
  if (name === 'diphthong') {
    const size = features.nucleusSize;
    const main = table.diphthongMain;
    const share = (features.nucleusMain ? main : 1) / (main + size - 1);
    const value = lookup(name, features.nucleusSymbol);
    return [scaleEntry(value, share)];
  }
  const long = token.long ? `${token.base}ː` : null;
  const value =
    (long && table.symbols[long]) ??
    table.symbols[token.symbol] ??
    table.symbols[token.base] ??
    table.classes[name];
  return [scaleEntry(value, 1)];
}

/**
 * The plain formula of Klatt (1979) in seconds.
 * @param {{inherent: number, minimum: number, percent: number, speechRate?: number, rateMinimum?: number, rateStretch?: number}} values
 *   Durations in milliseconds, `percent` from 0 up; `rateMinimum` and
 *   `rateStretch` (the head's, RATE_MINIMUM and RATE_STRETCH by default)
 *   are the exponents of the rate on the minimum and the stretch.
 */
export function durationFormula({
  inherent,
  minimum,
  percent,
  speechRate,
  rateMinimum = RATE_MINIMUM,
  rateStretch = RATE_STRETCH,
}) {
  const rate = speechRate ?? 1;
  const ms =
    minimum / rate ** rateMinimum +
    ((inherent - minimum) * percent) / 100 / rate ** rateStretch;
  return Math.max(ms, minimum / rate ** rateMinimum) / 1000;
}

/** Head key of the strength of each rule: durationClauseFinal. */
const RULE_KEYS = new Map(
  DURATION_RULES.map((rule) => [
    rule.name,
    `duration${rule.name[0].toUpperCase()}${rule.name.slice(1)}`,
  ])
);

/** Factor of a rule in `table`, null when it is switched off. */
export function ruleFactor(rule, table) {
  const factor = table?.rules?.[rule.name];
  return factor === undefined ? rule.factor : factor;
}

/**
 * Factor of one applying rule after the adjustments for the context and
 * the head.
 */
function effectiveFactor(rule, factor, features, options) {
  let value = factor;
  if (rule.exponent) {
    value **= rule.exponent(features);
  }
  if (rule.postvocalic && !features.phraseFinal) {
    value = 0.7 + 0.3 * value;
  }
  if (rule.stress) {
    value /= (options.stressLengthening ?? 1.35) / 1.35;
  }
  if (rule.name === 'clauseFinal') {
    const head =
      ((options.finalLengthening ?? BOUNDARIES.period.lengthen) - 1) /
      (BOUNDARIES.period.lengthen - 1);
    const boundary =
      (finalLengthening(features.phraseFinal) - 1) /
      (BOUNDARIES.period.lengthen - 1);
    value = 1 + (value - 1) * head * boundary;
  }
  // The head's strength of the rule: a power of a factor, a multiple of
  // an added duration.
  const strength = options[RULE_KEYS.get(rule.name)] ?? 1;
  if (strength !== 1) {
    value = rule.scope === 'add' ? value * strength : value ** strength;
  }
  return value;
}

/**
 * Rules that apply to a token with their effective factors.
 * @param {object} token
 * @param {object} features
 * @param {object} [table]
 * @param {{stressLengthening?: number, finalLengthening?: number}} [options]
 *   Head values: also the strengths `duration<Rule>` of the rules.
 * @returns {{rule: object, factor: number}[]}
 */
export function applyingRules(token, features, table = ENGLISH, options = {}) {
  const groups = new Set();
  const result = [];
  for (const rule of DURATION_RULES) {
    const factor = ruleFactor(rule, table);
    if (factor === null || (rule.group && groups.has(rule.group))) {
      continue;
    }
    if (!rule.applies(token, features)) {
      continue;
    }
    if (rule.group) {
      groups.add(rule.group);
    }
    result.push({
      rule,
      factor: effectiveFactor(rule, factor, features, options),
    });
  }
  return result;
}

/**
 * Duration in seconds of each part of a token (one part, or closure and
 * frication of an affricate).
 * @param {object} token
 * @param {object} features From `durationFeatures()`.
 * @param {object} [table] An entry of `DURATION_TABLES`.
 * @param {{speechRate?: number, stressLengthening?: number, finalLengthening?: number, rateMinimum?: number, rateStretch?: number}} [options]
 *   Head values, with the strengths `duration<Rule>` of the rules.
 * @returns {number[]}
 */
export function segmentParts(token, features, table = ENGLISH, options = {}) {
  const rate = options.speechRate ?? 1;
  const rateMinimum = options.rateMinimum ?? RATE_MINIMUM;
  let percent = 100;
  let minimumFactor = 1;
  let total = 1;
  let added = 0;
  for (const { rule, factor } of applyingRules(
    token,
    features,
    table,
    options
  )) {
    const scope = rule.scope ?? 'percent';
    if (scope === 'percent') {
      percent *= factor;
    } else if (scope === 'minimum') {
      minimumFactor *= factor;
    } else if (scope === 'total') {
      total *= factor;
    } else {
      added += factor;
    }
  }
  const parts = phonemeDurations(token, features, table);
  const share = parts.length > 1 ? 1 / parts.length : 1;
  return parts.map(({ inherent, minimum }) => {
    const floor = minimum * minimumFactor;
    const base = durationFormula({
      inherent,
      minimum: floor,
      percent,
      speechRate: rate,
      rateMinimum,
      rateStretch: options.rateStretch ?? RATE_STRETCH,
    });
    const extra = (added * share) / 1000 / rate ** rateMinimum;
    return (base + extra) * total;
  });
}

/**
 * Duration of a token in seconds: `minimum + (inherent - minimum) *
 * percent / 100` with the rate exponents, the rules of `table` and the
 * head's `stressLengthening` and `finalLengthening`.
 * @param {object} token
 * @param {object} features From `durationFeatures()`.
 * @param {object} [table] An entry of `DURATION_TABLES`.
 * @param {{speechRate?: number, stressLengthening?: number, finalLengthening?: number}} [options]
 * @returns {number}
 */
export function segmentDuration(
  token,
  features,
  table = ENGLISH,
  options = {}
) {
  return segmentParts(token, features, table, options).reduce(
    (sum, part) => sum + part,
    0
  );
}

/**
 * The shortest a token can get at `speechRate`: its minimum (halved when
 * unstressed) over `speechRate ** rateMinimum` (the head's, RATE_MINIMUM by
 * default), in seconds.
 */
export function minimumDuration(
  token,
  features,
  table = ENGLISH,
  options = {}
) {
  const rate = options.speechRate ?? 1;
  const exponent = options.rateMinimum ?? RATE_MINIMUM;
  const halved = applyingRules(token, features, table, options)
    .filter(({ rule }) => rule.scope === 'minimum')
    .reduce((product, { factor }) => product * factor, 1);
  return phonemeDurations(token, features, table).reduce(
    (sum, part) => sum + (part.minimum * halved) / rate ** exponent / 1000,
    0
  );
}

/**
 * Pause length in seconds: boundaries of strength 2 and more shrink with
 * `speechRate ** RATE_PAUSE`, word boundaries keep their 12 ms.
 * @param {number} base Pause of the boundary times the head's pauseLength.
 * @param {number} strength
 * @param {number} [speechRate]
 */
export function scalePause(base, strength, speechRate = 1) {
  return strength >= 2 ? base / speechRate ** RATE_PAUSE : base;
}
