/**
 * IPA string parser.
 *
 * Turns an IPA transcription such as `ˈhɛloʊ ˈwɝld` or `ma˨˩˦` into a flat
 * list of segment tokens with resolved articulatory features. Diacritics
 * modify the preceding segment, stress marks apply to the next vowel, tone
 * letters attach to the previous vowel, and tie bars join affricates.
 *
 * Pauses carry a prosodic boundary class (comma, question, paren, ...);
 * `(` ... `)` mark the segments between them as parenthetical, and the
 * arrows `↗`/`↘` set a rising or falling contour on the next phrase end.
 *
 * Speech markup (see docs/markup.md): the brace spans of ExtIPA/VoQS
 * (`{W … W}`, `{3V̤ … V̤}`, `{f … f}`, see `MODE_LABELS` in inventory.js)
 * change the mode of the words between them; `(.)`, `(..)`, `(...)` and
 * `(1.2)` are timed pauses, `⸨laugh⸩` is a non-speech sound and `ˈˈ` is a
 * primary stress with strong emphasis. A brace chunk is not a word.
 */

import {
  BOUNDARY_CLASSES,
  BOUNDARY_RANKS,
  CONTOUR_MARKS,
  DIACRITICS,
  PAUSES,
  STRESS_MARKS,
  TONE_LETTERS,
  getPhoneme,
} from './inventory.js';
import { MARKUP_LIMITS } from '../markup/builder.js';
import { SOUND_NAMES, isDefaultMode } from '../markup/modes.js';
import { ModeStack, wordSpans, writeMarks } from './marks.js';

const SUPERSCRIPT_TONES = { '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5 };
const WRITTEN_TONES = Object.keys(TONE_LETTERS);

/** Symbols that IPA writers commonly substitute with lookalikes. */
const ALIASES = { g: 'ɡ', ':': 'ː', "'": 'ˈ', ʦ: 't', ʧ: 't', ʤ: 'd' };

/** Second half of legacy affricate ligatures, injected after the stop. */
const LIGATURE_TAILS = { ʦ: 's', ʧ: 'ʃ', ʤ: 'ʒ' };

function normalizeText(text) {
  return (
    String(text ?? '')
      .normalize('NFD')
      // NFD splits ç into c + cedilla, which is a different IPA symbol.
      .replaceAll('ç', 'ç')
      .replaceAll('\r', ' ')
      .replaceAll('\t', ' ')
      .replaceAll('\n', ' | ')
      .replaceAll('/', ' ')
      .replaceAll('[', ' ')
      .replaceAll(']', ' ')
  );
}

function createSegment(symbol, phoneme, wordIndex) {
  return {
    kind: phoneme.kind,
    symbol,
    base: symbol,
    phoneme,
    voiced: phoneme.voiced,
    stress: 0,
    long: false,
    nasalized: false,
    aspirated: false,
    breathy: false,
    palatalized: false,
    labialized: false,
    velarized: false,
    syllabic: phoneme.kind === 'vowel',
    rhotic: symbol === 'ɚ' || symbol === 'ɝ',
    tone: null,
    affricate: null,
    word: wordIndex,
  };
}

/** Feature updates applied by each modifier diacritic. */
const DIACRITIC_EFFECTS = {
  aspirated: { aspirated: true },
  unaspirated: { aspirated: false, unaspirated: true },
  breathy: { breathy: true, aspirated: true },
  palatalized: { palatalized: true },
  labialized: { labialized: true },
  velarized: { velarized: true },
  pharyngealized: { velarized: true },
  long: { long: true },
  nasalized: { nasalized: true },
  voiceless: { voiced: false },
  voiced: { voiced: true },
  syllabic: { syllabic: true },
  nonSyllabic: { syllabic: false },
  rhotic: { rhotic: true },
  // VoQS voice quality of one phone; carried, not yet heard (#52).
  breathyVoice: { breathy: true },
  creaky: { creaky: true },
  whispered: { whispered: true },
};

function applyDiacritic(segment, mark, char) {
  segment.symbol += char;
  Object.assign(segment, DIACRITIC_EFFECTS[mark]);
}

function lastVowel(tokens) {
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (
      (token.kind === 'pause' && token.strength > 0) ||
      token.kind === 'sound'
    ) {
      return null;
    }
    if (
      token.kind === 'vowel' ||
      (token.kind === 'consonant' && token.syllabic)
    ) {
      return token;
    }
  }
  return null;
}

function addTone(state, level) {
  const target = lastVowel(state.tokens);
  if (target) {
    (target.tone ??= []).push(level);
  }
}

function updateParens(state, char) {
  if (char === '(') {
    state.parenDepth++;
  } else if (char === ')') {
    state.parenDepth = Math.max(0, state.parenDepth - 1);
  }
}

function mergePause(pause, char, strength) {
  if (strength > pause.strength) {
    pause.strength = strength;
    pause.symbol = char;
  }
  const boundary = BOUNDARY_CLASSES[char];
  if (BOUNDARY_RANKS[boundary] > BOUNDARY_RANKS[pause.boundary]) {
    pause.boundary = boundary;
  }
  pause.question = pause.question || char === '?';
}

function addPause(state, char) {
  const strength = PAUSES[char];
  const previous = state.tokens.at(-1);
  const closing = char === ')';
  if (!closing) {
    updateParens(state, char);
  }
  if (!previous) {
    return;
  }
  let pause = previous;
  const timed = previous.seconds !== undefined || previous.kind === 'sound';
  if (timed && strength === 0) {
    // The space after a timed pause or a sound adds nothing.
    return;
  }
  if (previous.kind === 'pause' && !timed) {
    mergePause(previous, char, strength);
  } else {
    if (!timed) {
      state.word++;
    }
    pause = {
      kind: 'pause',
      symbol: char,
      strength,
      boundary: BOUNDARY_CLASSES[char],
      question: char === '?',
      word: -1,
    };
    state.tokens.push(pause);
  }
  if (closing) {
    // The pause after `)` still ends the parenthetical phrase.
    pause.parenthetical = state.parenDepth > 0;
    updateParens(state, char);
  }
  if (state.pendingContour && pause.strength >= 2) {
    pause.contour = state.pendingContour;
    state.pendingContour = null;
  }
}

function addSegment(state, char, phoneme) {
  const previous = state.tokens.at(-1);
  const joins =
    state.pendingTie &&
    previous?.kind === 'consonant' &&
    phoneme.kind === 'consonant' &&
    !previous.affricate;
  state.pendingTie = false;
  if (joins) {
    previous.affricate = { stop: previous.base, fricative: char };
    previous.symbol += `\u0361${char}`;
    previous.phoneme = phoneme;
    previous.voiced = phoneme.voiced;
    return;
  }
  const segment = createSegment(char, phoneme, state.word);
  if (state.parenDepth > 0) {
    segment.parenthetical = true;
  }
  if (state.pendingSyllable) {
    // A stress mark is written at the start of its syllable.
    segment.syllableStart = true;
    state.pendingSyllable = false;
  }
  if (phoneme.kind === 'vowel' && state.pendingStress) {
    segment.stress = state.pendingStress;
    state.pendingStress = 0;
    if (state.pendingEmphasis) {
      segment.emphasis = 1;
      state.emphasized.add(state.word);
      state.pendingEmphasis = false;
    }
  }
  if (state.wordModes && !state.wordModes.has(state.word)) {
    state.wordModes.set(state.word, state.modes.mode);
  }
  state.tokens.push(segment);
}

function addModifier(state, char, mark) {
  const previous = state.tokens.at(-1);
  if (mark === 'tie') {
    state.pendingTie = true;
  } else if (isSegment(previous)) {
    applyDiacritic(previous, mark, char);
  }
}

function consumeChar(state, char) {
  const toneLevel = TONE_LETTERS[char] ?? SUPERSCRIPT_TONES[char];
  const phoneme = getPhoneme(char);
  if (STRESS_MARKS[char]) {
    state.pendingStress = STRESS_MARKS[char];
    state.pendingSyllable = true;
  } else if (CONTOUR_MARKS[char]) {
    state.pendingContour = CONTOUR_MARKS[char];
  } else if (toneLevel) {
    addTone(state, toneLevel);
  } else if (char in PAUSES) {
    addPause(state, char);
  } else if (DIACRITICS[char]) {
    addModifier(state, char, DIACRITICS[char]);
  } else if (phoneme) {
    addSegment(state, char, phoneme);
  } else if (char.trim()) {
    state.unknown.push(char);
  }
}

/** Seconds of the written timed pauses. */
const TIMED_PAUSES = { '.': 0.2, '..': 0.4, '...': 0.8 };

/** Whitespace, or a chunk between spaces (a sound `⸨…⸩` may hold any). */
const CHUNKS = /(?:⸨[^⸩]*⸩|[^\s⸨]+|⸨)+|\s+/gu;

/** Marks inside a chunk: a sound, a timed pause, the emphasis `ˈˈ`. */
const INNER_MARKS = /⸨([^⸩]*)⸩|\((\.{1,3}|\d+(?:\.\d+)?)\)|ˈˈ/gu;

const isSegment = (token) =>
  token !== undefined && token.kind !== 'pause' && token.kind !== 'sound';

/** A timed pause or a sound after a word starts the next word. */
function pushTimed(state, token) {
  const previous = state.tokens.at(-1);
  if (isSegment(previous)) {
    state.word++;
  }
  if (
    token.kind === 'pause' &&
    previous?.kind === 'pause' &&
    previous.strength === 0 &&
    previous.seconds === undefined
  ) {
    // `ma (.) ma`: the timed pause takes the place of the space.
    state.tokens[state.tokens.length - 1] = token;
    return;
  }
  state.tokens.push(token);
}

function addTimedPause(state, symbol, written) {
  const seconds = Math.min(
    MARKUP_LIMITS.maxPauseSeconds,
    TIMED_PAUSES[written] ?? Number(written)
  );
  pushTimed(state, {
    kind: 'pause',
    symbol,
    strength: 1,
    boundary: 'quote',
    question: false,
    word: -1,
    seconds,
  });
}

/**
 * A sound `⸨laugh⸩`, or `⸨laugh:0.5⸩` with its length in seconds (also
 * read: `⸨laugh 0.5⸩`). A sound inside brace marks keeps their mode: it is
 * listed in the mode spans as `{sound, mode}` (`sound` is its index among
 * the sounds of the string).
 */
function addSound(state, symbol, written) {
  const [, name, seconds] =
    /^\s*([^\s:]+?)(?:(?:\s*:\s*|\s+)(\d+(?:\.\d+)?))?\s*$/u.exec(written) ??
    [];
  if (!SOUND_NAMES.includes(name)) {
    state.unknown.push(symbol);
    return;
  }
  const token = { kind: 'sound', symbol, name, word: -1 };
  if (seconds !== undefined) {
    token.duration = Math.min(MARKUP_LIMITS.maxPauseSeconds, Number(seconds));
  }
  if (!isDefaultMode(state.modes.mode)) {
    state.soundModes.push({ sound: state.sounds, mode: state.modes.mode });
  }
  state.sounds++;
  pushTimed(state, token);
}

function consumeText(state, text) {
  for (const raw of text) {
    consumeChar(state, ALIASES[raw] ?? raw);
    const tail = LIGATURE_TAILS[raw];
    if (tail) {
      consumeChar(state, '\u0361');
      consumeChar(state, tail);
    }
  }
}

/** The IPA of a sound: `⸨laugh⸩`, or `⸨laugh:0.5⸩` with a length. */
export function soundIpa(name, duration) {
  return duration === null || duration === undefined
    ? `⸨${name}⸩`
    : `⸨${name}:${Number(duration.toFixed(3))}⸩`;
}

/** Read a chunk between spaces that is not a brace mark. */
function consumeChunk(state, chunk) {
  let index = 0;
  for (const found of chunk.matchAll(INNER_MARKS)) {
    consumeText(state, chunk.slice(index, found.index));
    index = found.index + found[0].length;
    if (found[1] !== undefined) {
      addSound(state, found[0], found[1]);
    } else if (found[2] !== undefined) {
      addTimedPause(state, found[0], found[2]);
    } else {
      state.pendingStress = 1;
      state.pendingSyllable = true;
      state.pendingEmphasis = true;
    }
  }
  consumeText(state, chunk.slice(index));
}

function consumeMarkup(state, text) {
  for (const [chunk] of text.matchAll(CHUNKS)) {
    if (/^\s/u.test(chunk)) {
      consumeText(state, chunk);
    } else if (chunk.startsWith('{') || chunk.endsWith('}')) {
      if (!state.modes.read(chunk)) {
        state.unknown.push(chunk);
      }
    } else {
      consumeChunk(state, chunk);
    }
  }
}

/**
 * Parse an IPA string.
 * @param {string} text
 * @returns {{tokens: object[], unknown: string[], modes: {from: number, to: number, mode: object}[]}}
 *   `modes` are the spans of the brace marks and `ˈˈ` in IPA word indexes
 *   (`token.word`; `to` is exclusive).
 */
export function parseIpa(text) {
  const normalized = normalizeText(text);
  if (normalized.length === 1 && !LIGATURE_TAILS[normalized]) {
    const symbol = ALIASES[normalized] ?? normalized;
    const phoneme = getPhoneme(symbol);
    if (phoneme) {
      return {
        tokens: [createSegment(symbol, phoneme, 0)],
        unknown: [],
        modes: [],
      };
    }
  }
  const markup = /[{}⸨(]|ˈˈ/u.test(normalized);
  const state = {
    tokens: [],
    unknown: [],
    word: 0,
    pendingStress: 0,
    pendingSyllable: false,
    pendingEmphasis: false,
    pendingContour: null,
    parenDepth: 0,
    pendingTie: false,
    modes: markup ? new ModeStack() : null,
    wordModes: markup ? new Map() : null,
    emphasized: markup ? new Set() : null,
    sounds: 0,
    soundModes: markup ? [] : null,
  };
  if (markup) {
    consumeMarkup(state, normalized);
  } else {
    consumeText(state, normalized);
  }
  while (
    state.tokens.at(-1)?.kind === 'pause' &&
    state.tokens.at(-1).strength === 0
  ) {
    state.tokens.pop();
  }
  return {
    tokens: state.tokens,
    unknown: state.unknown,
    modes: markup
      ? [...wordSpans(state.wordModes, state.emphasized), ...state.soundModes]
      : [],
  };
}

/** The written form of one token. */
function tokenText(token) {
  if (token.kind === 'sound') {
    return ` ${soundIpa(token.name, token.duration)} `;
  }
  if (token.kind === 'pause') {
    if (token.seconds !== undefined) {
      return ` ${token.symbol} `;
    }
    return token.strength === 0 ? ' ' : `${token.symbol} `;
  }
  let text = '';
  if (token.stress === 1) {
    text += token.emphasis === 1 ? 'ˈˈ' : 'ˈ';
  } else if (token.stress === 2) {
    text += 'ˌ';
  }
  text += token.symbol;
  if (token.tone) {
    text += token.tone.map((level) => WRITTEN_TONES[5 - level]).join('');
  }
  return text;
}

/**
 * Render tokens back to an IPA string (useful for round-trip tests and UIs).
 * Stress is stored on the syllable nucleus, so the mark is written right
 * before the vowel. With `modes` (spans in word indexes, as `parseIpa()`
 * returns them) the brace marks and `ˈˈ` of each span are written too.
 * Sounds are written `⸨name⸩` or `⸨name:seconds⸩`.
 * @param {object[]} tokens
 * @param {{from: number, to: number, mode: object}[]} [modes]
 */
export function formatIpa(tokens, modes = []) {
  const pieces = [];
  for (const token of tokens) {
    const word = isSegment(token) ? token.word : -1;
    const last = pieces.at(-1);
    if (word >= 0 && last?.word === word) {
      last.text += tokenText(token);
    } else {
      pieces.push({
        text: tokenText(token),
        word,
        ...(token.kind === 'sound' ? { sound: true } : {}),
      });
    }
  }
  return writeMarks(pieces, modes)
    .map((part) => (/^\{|\}$/u.test(part) ? ` ${part} ` : part))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
