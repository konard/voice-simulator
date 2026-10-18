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

const SUPERSCRIPT_TONES = { '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5 };

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
};

function applyDiacritic(segment, mark, char) {
  segment.symbol += char;
  Object.assign(segment, DIACRITIC_EFFECTS[mark]);
}

function lastVowel(tokens) {
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token.kind === 'pause' && token.strength > 0) {
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

function expandLigatures(text) {
  const chars = [];
  for (const raw of normalizeText(text)) {
    const char = ALIASES[raw] ?? raw;
    chars.push(char);
    if (LIGATURE_TAILS[raw]) {
      chars.push('\u0361', LIGATURE_TAILS[raw]);
    }
  }
  return chars;
}

function addTone(state, level) {
  const target = lastVowel(state.tokens);
  if (target) {
    target.tone = [...(target.tone ?? []), level];
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
  if (previous.kind === 'pause') {
    mergePause(previous, char, strength);
  } else {
    state.word++;
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
  }
  state.tokens.push(segment);
}

function addModifier(state, char, mark) {
  const previous = state.tokens.at(-1);
  if (mark === 'tie') {
    state.pendingTie = true;
  } else if (previous && previous.kind !== 'pause') {
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

/**
 * Parse an IPA string.
 * @param {string} text
 * @returns {{tokens: object[], unknown: string[]}}
 */
export function parseIpa(text) {
  const state = {
    tokens: [],
    unknown: [],
    word: 0,
    pendingStress: 0,
    pendingSyllable: false,
    pendingContour: null,
    parenDepth: 0,
    pendingTie: false,
  };
  for (const char of expandLigatures(text)) {
    consumeChar(state, char);
  }
  while (
    state.tokens.at(-1)?.kind === 'pause' &&
    state.tokens.at(-1).strength === 0
  ) {
    state.tokens.pop();
  }
  return { tokens: state.tokens, unknown: state.unknown };
}

/**
 * Render tokens back to an IPA string (useful for round-trip tests and UIs).
 * Stress is stored on the syllable nucleus, so the mark is written right
 * before the vowel.
 * @param {object[]} tokens
 */
export function formatIpa(tokens) {
  let text = '';
  for (const token of tokens) {
    if (token.kind === 'pause') {
      text += token.strength === 0 ? ' ' : `${token.symbol} `;
      continue;
    }
    if (token.stress === 1) {
      text += 'ˈ';
    } else if (token.stress === 2) {
      text += 'ˌ';
    }
    text += token.symbol;
    if (token.tone) {
      text += token.tone
        .map((level) => Object.keys(TONE_LETTERS)[5 - level])
        .join('');
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}
