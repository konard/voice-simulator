/**
 * Intonation models per language (issue 51): sentence types, focus and
 * the Russian intonation constructions.
 *
 * Every syllable of a phrase without lexical tones gets a pitch target in
 * semitones from `head.pitch`:
 *
 *     st = register + declination(t) + range · tune
 *
 * - `register` is the shift of `REGISTERS` (exclamation, parenthetical)
 *   plus the `pitch` of the speech mode;
 * - `declination(t)` is the declination of prosody.js: the head's
 *   `declination` across each intonation phrase, taken at the start of the
 *   syllable's vowel, and one step down per earlier phrase of the sentence;
 * - `range = head.pitchRange / 3 · REGISTERS.range · mode.range`;
 * - `tune` is the value of the tune at that syllable (the tables below).
 *
 * A phrase has a pre-nucleus, a nucleus and a tail. The nucleus is the
 * stressed syllable of the last word with focus (`ˈˈ`, `*word*`,
 * `<emphasis>` or a mode with `emphasis` 0.5 or more), else of the last
 * word with a primary stress. `B` (`end`) is the pitch at the end of the
 * phrase. The targets are level steps that the tone model of issue 49
 * (tone-model.js) approaches with the rate `INTONATION_RATE`: a syllable
 * holds its first value from the end of the vowel before it and changes
 * at the fractions of its vowel listed in its steps.
 *
 * The tune of a phrase comes from `mode.tune` (`{IK4 … IK4}`,
 * `[tune name]`, `<vs:tune name="…">`), else from the punctuation that
 * ends it (`phraseTuneName()`): `.` statement, `?` yes/no question,
 * `↘ ?` wh-question, `↗ ?` echo question, `,` and `|` continuation,
 * `↗ |` the first half of an alternative question, `!` exclamation, and
 * the tag questions `, … ↗ ?` and `, … ↘ ?`. Each language maps these
 * names onto its own tunes: Russian onto the intonation constructions
 * (IK, Bryzgunova 1977), Hindi onto accent phrases, Mandarin keeps its
 * tones and only raises the pitch of a question (prosody.js).
 */

import { DIPHTHONGS } from '../ipa/syllables.js';
import {
  BOUNDARIES,
  boundaryOf,
  intonationPhrases,
  isTonalPhrase,
  pitchShift,
} from './prosody.js';

/**
 * English tunes, values in semitones at a pitch range of 3 (`range` 1):
 * `accent` on the stressed syllables before the nucleus (`first` on the
 * first word instead), the `nucleus` moves `[from, to]`, then the `tail`
 * reaches `end` (B): `ramp` linearly over the tail syllables, `dip` stays
 * at `dip` until the last syllable rises to `end`, `step` reaches it on the
 * first tail syllable and `level` holds it. `rate` changes the tempo.
 * The values follow the British nuclear tones of O'Connor and Arnold
 * (1973) as sketched in issue 51.
 */
const EN = {
  statement: { accent: 1.8, nucleus: [2, 1], tail: 'ramp', end: -3.5 },
  wh: { accent: 1.8, first: 3, nucleus: [2, 1], tail: 'ramp', end: -3.5 },
  yesno: { accent: 1.8, nucleus: [-1.5, -1], tail: 'ramp', end: 7 },
  echo: { accent: 2.5, nucleus: [-1.5, 0], tail: 'ramp', end: 10 },
  continuation: {
    accent: 1.8,
    nucleus: [2, 1],
    tail: 'dip',
    dip: -1,
    end: 3.5,
  },
  'alt-rise': { accent: 1.8, nucleus: [-1, 3], tail: 'ramp', end: 5 },
  'tag-ask': { accent: 0, nucleus: [-1.5, -1], tail: 'ramp', end: 6 },
  'tag-confirm': { accent: 0, nucleus: [2, 0], tail: 'ramp', end: -3.5 },
  exclamation: { accent: 1.8, nucleus: [-1, 4], tail: 'ramp', end: -4.5 },
  command: { accent: 1.8, first: 3, nucleus: [3, 0], tail: 'step', end: -5 },
  parenthesis: {
    accent: 0.9,
    nucleus: [1, 0],
    tail: 'ramp',
    end: -1.5,
    rate: 1.1,
  },
  call: { accent: 0, nucleus: [4, 4], tail: 'level', end: 1 },
};

/**
 * Russian intonation constructions (IK1 to IK7, Bryzgunova 1977): no
 * accents before the centre (`accent` 0), the centre moves `nucleus`, the
 * syllables after it are at `end` (`after`: a centre at the end of the
 * phrase keeps its own last value). `at` is the fraction of the centre
 * vowel where it moves (IK3 rises from the start of the vowel: within
 * 150 ms at the rate below). IK2 makes the centre 3 dB louder. IK5 rises
 * on its first centre (the first stressed syllable), holds `plateau` and
 * falls on the second; IK7 ends in a glottal stop (`label`, not rendered).
 */
const RU = {
  IK1: { accent: 0, nucleus: [0, -5], tail: 'after', end: -5 },
  IK2: { accent: 0, nucleus: [1, -2], tail: 'after', end: -4, gain: 3 },
  IK3: { accent: 0, nucleus: [-1, 8], at: 0.1, tail: 'after', end: -2 },
  IK4: { accent: 0, nucleus: [-3, 3], tail: 'ramp', end: 4 },
  IK5: { accent: 0, plateau: 6, nucleus: [6, -2], tail: 'after', end: -2 },
  IK6: { accent: 0, nucleus: [0, 6], tail: 'after', end: 6 },
  IK7: { accent: 0, nucleus: [0, 6], tail: 'after', end: -2, label: 'ʔ' },
};

/**
 * Hindi: every word before the last one with two or more syllables is an
 * accent phrase, low on its first vowel and high on its last (`accent`),
 * each one `downstep` lower than the one before; the last word falls to
 * `end`, a rising question rises to `end` on its last syllable.
 * UNVERIFIED: the values are a sketch after Harnsberger (1999) and Patil
 * et al. (2008), not fitted to recordings.
 */
const HI = {
  accent: { first: -1, last: 3, downstep: 1 },
  statement: { end: -3.5 },
  question: { end: 6 },
  continuation: { end: 3.5 },
  focus: { after: 0.5 },
};

/**
 * Mandarin keeps its tones (prosody.js): a question without a particle
 * raises the pitch linearly to `raise` semitones at the end of the
 * phrase, halves the declination and widens the tone range of the last
 * syllable; after a particle (吗, 呢, a neutral last syllable) the raise
 * ends at `particle`; a wh-question (`↘ ?`) is not raised. An exclamation
 * widens the tone range with `REGISTERS.exclamation`.
 */
const ZH = {
  question: { raise: 3, declination: 0.5, lastScale: 1.3 },
  particle: { raise: 1, declination: 1, lastScale: 1 },
  wh: { raise: 0, declination: 1, lastScale: 1 },
};

/** The tunes of every language. */
export const TUNES = deepFreeze({ en: EN, ru: RU, hi: HI, zh: ZH });

/**
 * Focus (`*word*`, `<emphasis>`, `ˈˈ`) at full strength; `mode.emphasis`
 * scales it (1 full, 0.5 half) and -0.5 takes the accent off a word.
 * English: the nucleus `pitch` semitones higher, the word `duration`
 * times longer and `gain` dB louder; after it, accents times `accents`
 * and the pitch `level` semitones lower. Russian: the focused word is the
 * centre. Hindi: after it, the range times `after`. Mandarin: the tone
 * range of the word times `scale`, after it times `after` and `level`
 * semitones lower.
 */
export const FOCUS = deepFreeze({
  en: { pitch: 2.9, duration: 1.2, gain: 3, accents: 0.3, level: -2 },
  ru: { centre: true },
  hi: { after: 0.5 },
  zh: { scale: 1.4, after: 0.5, level: -4 },
});

/** Approach rate (per second) of the intonation targets (tone-model.js). */
export const INTONATION_RATE = 60;

/** Names of every tune, for the markup (`[tune name]`, `{IK3 … IK3}`). */
export const TUNE_NAMES = Object.freeze([
  ...Object.keys(EN),
  ...Object.keys(RU),
]);

/** Generic tune names to the Russian construction and its scale. */
const RUSSIAN_TUNES = {
  statement: ['IK1', 1],
  wh: ['IK2', 1],
  yesno: ['IK3', 1],
  echo: ['IK3', 1],
  continuation: ['IK3', 0.7],
  'alt-rise': ['IK3', 1],
  'tag-ask': ['IK3', 1],
  'tag-confirm': ['IK1', 1],
  exclamation: ['IK2', 1],
  command: ['IK2', 1],
  parenthesis: ['IK1', 0.5],
};

/** Generic tune names that end a Hindi phrase high. */
const HINDI_RISES = new Set(['yesno', 'echo', 'alt-rise', 'tag-ask']);

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return Object.freeze(object);
}

/**
 * The intonation model of a language tag: `en`, `ru`, `hi` or `zh`; other
 * languages use the English tunes.
 * @param {string|null|undefined} language
 */
export function intonationLanguage(language) {
  const base = String(language ?? 'en')
    .toLowerCase()
    .split(/[-_]/u)[0];
  return Object.hasOwn(TUNES, base) ? base : 'en';
}

/** Words (IPA word indexes) of a phrase, in order. */
function phraseWords(phrase) {
  return [...new Set(phrase.nuclei.map((segment) => segment.token?.word))];
}

/** Language of a phrase: the `lang` of its mode, else the utterance's. */
function phraseLanguage(phrase, language) {
  const tagged = phrase.nuclei.findLast((segment) => segment.token?.mode?.lang);
  return intonationLanguage(tagged?.token.mode.lang ?? language);
}

/** The tune named by the mode of a phrase (`mode.tune`), if any. */
function explicitTune(phrase) {
  return (
    phrase.nuclei.findLast((segment) => segment.token?.mode?.tune)?.token.mode
      .tune ?? null
  );
}

/** Whether a phrase is a question tag after a comma (`, aren't you ↗ ?`). */
function isTag(phrases, index, language) {
  const phrase = phrases[index];
  const previous = phrases[index - 1];
  return (
    language === 'en' &&
    Boolean(phrase.pause?.question && phrase.pause.contour) &&
    previous?.pause?.boundary === 'comma' &&
    phraseWords(phrase).length <= 2
  );
}

/**
 * The generic tune name of the phrase at `index` from the punctuation
 * that ends it (and the phrase after it, for a tag question).
 * @param {object[]} phrases from `intonationPhrases()`
 * @param {number} index
 * @param {string} [language] intonation language of the phrase
 * @returns {string}
 */
export function phraseTuneName(phrases, index, language = 'en') {
  const phrase = phrases[index];
  const pause = phrase.pause;
  if (phrase.nuclei.every((segment) => segment.token?.parenthetical)) {
    return 'parenthesis';
  }
  const boundary = boundaryOf(pause);
  if (!pause || boundary === 'period' || boundary === 'ellipsis') {
    return 'statement';
  }
  if (boundary === 'question') {
    const tag = isTag(phrases, index, language);
    if (pause.contour === 'fall') {
      return tag ? 'tag-confirm' : 'wh';
    }
    if (pause.contour === 'rise') {
      return tag ? 'tag-ask' : 'echo';
    }
    return 'yesno';
  }
  if (boundary === 'exclamation') {
    return 'exclamation';
  }
  if (boundary === 'semicolon' || pause.contour === 'fall') {
    return 'statement';
  }
  if (
    (boundary === 'dash' || boundary === 'comma') &&
    pause.contour === 'rise'
  ) {
    return 'alt-rise';
  }
  const next = phrases[index + 1];
  if (boundary === 'comma' && next && isTag(phrases, index + 1, language)) {
    return 'statement';
  }
  return 'continuation';
}

/**
 * The tune of a phrase for its language: `{name, tune, scale}` where
 * `tune` is an entry of `TUNES.en` or `TUNES.ru` (Hindi: `{hindi: name}`,
 * Mandarin: an entry of `TUNES.zh`).
 */
function resolveTune(name, explicit, language, phrase) {
  if (isTonalPhrase(phrase)) {
    return { name, zh: zhTune(name, phrase), scale: 1 };
  }
  if (explicit) {
    const tune = EN[explicit] ?? RU[explicit];
    if (tune) {
      return { name: explicit, tune, scale: 1 };
    }
  }
  if (language === 'hi') {
    let hindi = 'statement';
    if (HINDI_RISES.has(name)) {
      hindi = 'question';
    } else if (name === 'continuation') {
      hindi = 'continuation';
    }
    return { name, hindi, scale: 1 };
  }
  if (language === 'ru') {
    const [ik, scale] = RUSSIAN_TUNES[name] ?? ['IK1', 1];
    return { name: ik, tune: RU[ik], scale };
  }
  return { name, tune: EN[name] ?? EN.statement, scale: 1 };
}

/** The Mandarin question shape of a phrase with tones. */
function zhTune(name, phrase) {
  if (name === 'yesno' || name === 'echo' || name === 'tag-ask') {
    const last = phrase.nuclei.at(-1).token;
    return !last?.tone?.length && !last?.stress ? ZH.particle : ZH.question;
  }
  return null;
}

/** Focus strength of a token: 1 for `ˈˈ`, else `mode.emphasis`. */
function emphasisOf(token) {
  if (token?.emphasis) {
    return 1;
  }
  return token?.mode?.emphasis ?? 0;
}

/**
 * Syllables of a phrase as lists of nuclei: neighbouring vowels of one
 * word that form a diphthong (`eɪ`, `aɪ`, ...) are one syllable, as are
 * the vowels after a toneless one in a phrase with tones.
 * @param {object} phrase
 * @param {Map<object, number>} positions segment -> index
 * @returns {object[][]}
 */
export function phraseSyllables(phrase, positions) {
  const tonal = isTonalPhrase(phrase);
  const syllables = [];
  for (const segment of phrase.nuclei) {
    const current = syllables.at(-1);
    const last = current?.at(-1);
    const adjacent =
      last &&
      positions.get(segment) === positions.get(last) + 1 &&
      segment.token?.word === last.token?.word;
    let joins = false;
    if (adjacent && tonal) {
      joins = !last.token?.tone?.length;
    } else if (adjacent) {
      joins =
        current.length === 1 &&
        !last.token?.long &&
        !segment.token?.stress &&
        DIPHTHONGS.has(`${last.token?.base}${segment.token?.base}`);
    }
    if (joins) {
      current.push(segment);
    } else {
      syllables.push([segment]);
    }
  }
  return syllables;
}

const stressOf = (syllable) =>
  Math.max(...syllable.map((segment) => segment.token?.stress ?? 0));

const wordOf = (syllable) => syllable[0].token?.word;

/**
 * The focus of a phrase: the last word with emphasis 0.5 or more and its
 * strength, or null.
 */
function phraseFocus(syllables) {
  for (let index = syllables.length - 1; index >= 0; index--) {
    const strength = Math.max(
      ...syllables[index].map((segment) => emphasisOf(segment.token))
    );
    if (strength >= 0.5) {
      return { word: wordOf(syllables[index]), strength: Math.min(1, strength) };
    }
  }
  return null;
}

/** Whether a syllable's word lost its accent (`emphasis` -0.5). */
const deaccented = (syllable) =>
  syllable.some((segment) => (segment.token?.mode?.emphasis ?? 0) < 0);

/** Index of the nucleus syllable of a phrase. */
function nucleusIndex(syllables, focus) {
  const candidates = syllables
    .map((syllable, index) => ({ syllable, index }))
    .filter(({ syllable }) => !focus || wordOf(syllable) === focus.word);
  const accented = candidates.filter(({ syllable }) => !deaccented(syllable));
  for (const level of [1, 2]) {
    const found = accented.findLast(
      ({ syllable }) => stressOf(syllable) === level
    );
    if (found) {
      return found.index;
    }
  }
  const pool = accented.length ? accented : candidates;
  const lastWord = wordOf(pool.at(-1).syllable);
  return pool.find(({ syllable }) => wordOf(syllable) === lastWord).index;
}

/**
 * Analyse the intonation phrases of an utterance: tune, focus, syllables
 * and nucleus of every phrase.
 * @param {object[]} segments
 * @param {string} [language]
 */
export function analyzeIntonation(segments, language) {
  const phrases = intonationPhrases(segments);
  const positions = new Map(segments.map((segment, index) => [segment, index]));
  phrases.forEach((phrase, index) => {
    const lang = phraseLanguage(phrase, language);
    const generic = phraseTuneName(phrases, index, lang);
    const explicit = explicitTune(phrase);
    const resolved = resolveTune(generic, explicit, lang, phrase);
    const syllables = phraseSyllables(phrase, positions);
    const focus = phraseFocus(syllables);
    Object.assign(phrase, {
      language: lang,
      tuneName: resolved.name,
      tune: resolved.tune ?? null,
      tuneScale: resolved.scale,
      hindi: resolved.hindi ?? null,
      zh: resolved.zh ?? null,
      syllables,
      focus,
      nucleus: nucleusIndex(syllables, focus),
    });
  });
  return { phrases, positions };
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Tune values of the syllables of a phrase: per syllable `steps`, a list
 * of `[fraction of the vowel, value]` (the first one also holds over the
 * onset), and `accent` (whether the value is an accent that the head's
 * `accentStrength` scales).
 */
function tuneValues(phrase) {
  const { syllables, nucleus, tune, focus } = phrase;
  const scale = phrase.tuneScale;
  const values = syllables.map(() => ({ steps: [[0, 0]], accent: false }));
  const [from, to] = tune.nucleus.map((value) => value * scale);
  const end = tune.end * scale;
  const firstWord = wordOf(syllables[0]);
  const firstStressed = syllables.findIndex(
    (syllable, index) => index < nucleus && stressOf(syllable) === 1
  );
  for (let index = 0; index < nucleus; index++) {
    const syllable = syllables[index];
    if (deaccented(syllable)) {
      continue;
    }
    if (tune.plateau !== undefined && firstStressed >= 0) {
      if (index === firstStressed) {
        values[index].steps = [
          [0, 0],
          [0.5, tune.plateau * scale],
        ];
      } else if (index > firstStressed) {
        values[index].steps = [[0, tune.plateau * scale]];
      }
      continue;
    }
    if (stressOf(syllable) !== 1) {
      continue;
    }
    const first =
      tune.first !== undefined &&
      wordOf(syllable) === firstWord &&
      wordOf(syllables[nucleus]) !== firstWord;
    values[index] = {
      steps: [[0, (first ? tune.first : tune.accent) * scale]],
      accent: true,
    };
  }
  const tail = syllables.length - 1 - nucleus;
  const at = tune.at ?? 0.5;
  if (tail === 0) {
    values[nucleus].steps = lastNucleusSteps(tune, from, to, end, at, scale);
  } else {
    values[nucleus].steps =
      from === to
        ? [[0, from]]
        : [
            [0, from],
            [at, to],
          ];
    if (tune.tail === 'dip' && tail === 1) {
      // A fall-rise falls on its nucleus and rises on the tail.
      values[nucleus].steps = [
        [0, from],
        [0.25, to],
        [0.55, tune.dip * scale],
      ];
    }
    for (let offset = 1; offset <= tail; offset++) {
      values[nucleus + offset].steps = tailSteps(
        tune,
        offset,
        tail,
        to,
        end,
        scale
      );
    }
  }
  if (focus && tune.accent > 0) {
    // Post-focus syllables of English keep a trace of their accents.
    for (let index = nucleus + 1; index < syllables.length; index++) {
      if (stressOf(syllables[index]) === 1 && !deaccented(syllables[index])) {
        values[index].postAccent = tune.accent * scale;
      }
    }
  }
  return values;
}

/** Steps of a nucleus that is the last syllable of its phrase. */
function lastNucleusSteps(tune, from, to, end, at, scale) {
  if (tune.tail === 'after') {
    return [
      [0, from],
      [at, to],
    ];
  }
  if (tune.tail === 'dip') {
    return [
      [0, from],
      [0.3, tune.dip * scale],
      [0.6, end],
    ];
  }
  return from === to
    ? [
        [0, from],
        [0.4, end],
      ]
    : [
        [0, from],
        [0.3, to],
        [0.55, end],
      ];
}

/** Steps of the tail syllable `offset` of `count`. */
function tailSteps(tune, offset, count, to, end, scale) {
  switch (tune.tail) {
    case 'dip':
      return [[0, offset < count ? tune.dip * scale : end]];
    case 'step':
    case 'level':
    case 'after':
      return [[0, end]];
    default:
      return [[0, to + ((end - to) * offset) / count]];
  }
}

/** Tune values of a Hindi phrase (see `TUNES.hi`). */
function hindiValues(phrase) {
  const { syllables, focus } = phrase;
  const words = [];
  for (const syllable of syllables) {
    const word = wordOf(syllable);
    if (words.at(-1)?.word !== word) {
      words.push({ word, syllables: [] });
    }
    words.at(-1).syllables.push(syllable);
  }
  const values = [];
  let downstep = 0;
  words.forEach((entry, wordIndex) => {
    const count = entry.syllables.length;
    const last = wordIndex === words.length - 1;
    if (last) {
      const end = HI[phrase.hindi].end;
      const rises = phrase.hindi !== 'statement';
      entry.syllables.forEach((_, index) => {
        if (rises) {
          values.push(
            index < count - 1
              ? [[0, -downstep]]
              : [
                  [0, -downstep],
                  [0.3, end],
                ]
          );
        } else if (count === 1) {
          values.push([
            [0, -downstep],
            [0.4, end],
          ]);
        } else {
          values.push([[0, -downstep + ((end + downstep) * index) / (count - 1)]]);
        }
      });
      return;
    }
    if (count < 2) {
      values.push([[0, -downstep]]);
      return;
    }
    const { first, last: high } = HI.accent;
    entry.syllables.forEach((_, index) => {
      values.push([[0, first + ((high - first) * index) / (count - 1) - downstep]]);
    });
    downstep += HI.accent.downstep;
  });
  // Focus compresses the range of what follows it.
  let after = false;
  return values.map((steps, index) => {
    const word = wordOf(syllables[index]);
    const factor = after ? 1 - (1 - HI.focus.after) * focus.strength : 1;
    if (focus && word === focus.word) {
      after = true;
    } else if (focus && after) {
      // the word after the focus
    }
    return {
      steps: steps.map(([at, value]) => [at, value * factor]),
      accent: false,
    };
  });
}

/**
 * Pitch targets (tone-model intervals in semitones from `head.pitch`) of
 * the syllables of a phrase without tones.
 * @param {object} phrase analysed by `analyzeIntonation()`
 * @param {object} head
 * @returns {object[]} targets as described in prosody.js `pitchTargets()`
 */
export function intonationTargets(phrase, head) {
  const values = phrase.hindi ? hindiValues(phrase) : tuneValues(phrase);
  const { syllables, focus, nucleus } = phrase;
  const english = !phrase.hindi && phrase.language !== 'ru';
  const strengthOf = (value) =>
    value.accent ? (head.accentStrength ?? 1) : 1;
  const targets = [];
  let start = syllables[0][0].start;
  let afterFocus = false;
  syllables.forEach((nuclei, index) => {
    const vowelStart = nuclei[0].start;
    const end = nuclei.at(-1).end;
    const { shift, range } = pitchShift(nuclei[0], head, phrase);
    const factor = range / 3;
    const value = values[index];
    let level = 0;
    let boost = 0;
    let accentFactor = strengthOf(value);
    if (focus && english) {
      const strength = focus.strength;
      if (index === nucleus) {
        boost = FOCUS.en.pitch * strength;
      } else if (afterFocus) {
        level = FOCUS.en.level * strength;
      }
    }
    if (afterFocus && value.postAccent) {
      boost += value.postAccent * (1 - (1 - FOCUS.en.accents) * focus.strength);
      accentFactor = head.accentStrength ?? 1;
    }
    if (index === nucleus) {
      afterFocus = Boolean(focus);
    }
    const pitch = (tuneValue) =>
      round(shift + level + factor * (tuneValue * accentFactor + boost));
    const steps = value.steps;
    const onset = steps[0][1];
    const vowelSteps = steps;
    const intervals = [];
    const onsetDuration = Math.max(0, vowelStart - start);
    if (onsetDuration > 0) {
      intervals.push(level_(onsetDuration, pitch(onset)));
    }
    const vowel = Math.max(1e-6, end - vowelStart);
    vowelSteps.forEach(([at, stepValue], stepIndex) => {
      const next = vowelSteps[stepIndex + 1]?.[0] ?? 1;
      const duration = (next - at) * vowel;
      if (duration > 0) {
        intervals.push(level_(duration, pitch(stepValue)));
      }
    });
    const first = intervals[0].from;
    const last = intervals.at(-1).to;
    targets.push({
      segment: nuclei.find((item) => item.token?.stress) ?? nuclei[0],
      nuclei,
      phrase,
      start,
      end,
      neutral: false,
      from: head.pitch * 2 ** (first / 12),
      to: head.pitch * 2 ** (last / 12),
      points: [head.pitch * 2 ** (first / 12), head.pitch * 2 ** (last / 12)],
      intervals,
    });
    start = end;
  });
  return targets;
}

const level_ = (duration, value) => ({
  duration,
  from: value,
  to: value,
  rate: INTONATION_RATE,
});

/** Segments of the words of the phrase whose syllables pass `test`. */
function wordSegments(segments, words) {
  return segments.filter(
    (segment) => segment.kind !== 'pause' && words.has(segment.token?.word)
  );
}

/**
 * Durations of intonation: an English focus lengthens its word
 * (`FOCUS.en.duration`; the vowel with `ˈˈ` already has the emphasis rule
 * of durations.js) and a tune with a `rate` (parenthesis) speeds its
 * phrase up. Runs before the segments get their start and end.
 * @param {object[]} segments
 * @param {string} [language]
 */
export function applyIntonationTiming(segments, language) {
  const { phrases } = analyzeIntonation(segments, language);
  for (const phrase of phrases) {
    const words = new Set(phraseWords(phrase));
    const rate = phrase.tune?.rate ?? 1;
    if (rate !== 1) {
      for (const segment of wordSegments(segments, words)) {
        segment.duration /= rate;
      }
    }
    const focus = phrase.focus;
    if (focus && phrase.tune && phrase.language !== 'ru') {
      const factor = 1 + (FOCUS.en.duration - 1) * focus.strength;
      for (const segment of wordSegments(segments, new Set([focus.word]))) {
        if (!(segment.kind === 'vowel' && segment.token?.emphasis)) {
          segment.duration *= factor;
        }
      }
    }
  }
  return segments;
}

/**
 * Loudness gains of intonation, as factors per segment: the English focus
 * (`FOCUS.en.gain`) and the centre of IK2 (`TUNES.ru.IK2.gain`).
 * @param {object[]} segments
 * @param {string} [language]
 * @returns {Map<object, number>}
 */
export function intonationGains(segments, language) {
  const { phrases } = analyzeIntonation(segments, language);
  const gains = new Map();
  const louder = (word, decibels) => {
    for (const segment of wordSegments(segments, new Set([word]))) {
      gains.set(segment, (gains.get(segment) ?? 1) * 10 ** (decibels / 20));
    }
  };
  for (const phrase of phrases) {
    if (!phrase.tune) {
      continue;
    }
    const centre = wordOf(phrase.syllables[phrase.nucleus]);
    if (phrase.tune.gain) {
      louder(centre, phrase.tune.gain * phrase.tuneScale);
    }
    if (phrase.focus && phrase.language !== 'ru') {
      louder(phrase.focus.word, FOCUS.en.gain * phrase.focus.strength);
    }
  }
  return gains;
}

/** Whether `boundary` ends a sentence. */
export const endsSentence = (boundary) =>
  Boolean(BOUNDARIES[boundary]?.sentence);
