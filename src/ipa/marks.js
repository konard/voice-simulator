/**
 * ExtIPA/VoQS marks of an IPA string: brace spans such as `{W … W}` or
 * `{3V̤ … V̤}` that change the mode of the words between them, and the
 * strong emphasis `ˈˈ`. Reading happens in src/ipa/parse.js through
 * `ModeStack`; `writeMarks()` writes the marks of a list of modes over
 * the words of an IPA string (used by `formatIpa()` and `textToIpa()`).
 * See docs/markup.md.
 */

import {
  MODE_DEFAULTS,
  composeMode,
  isDefaultMode,
  modeKey,
} from '../markup/modes.js';
import { modeLabelChange } from './inventory.js';

/** An opening brace chunk `{label` with an optional degree digit. */
const OPENING = /^\{([123])?(.+)$/u;
/** A closing brace chunk `label}` (the digit is optional and ignored). */
const CLOSING = /^(?:[123])?(.*)\}$/u;

const sameLabel = (left, right) =>
  left.normalize('NFD') === right.normalize('NFD');

/** The stack of brace spans open while an IPA string is read. */
export class ModeStack {
  constructor() {
    this.entries = [{ label: null, mode: MODE_DEFAULTS }];
  }

  get mode() {
    return this.entries.at(-1).mode;
  }

  /**
   * Read a brace chunk; returns false when it is not a mark the parser
   * knows (the caller lists it as unknown).
   * @param {string} chunk
   */
  read(chunk) {
    const opening = chunk.startsWith('{') && !chunk.endsWith('}');
    if (opening) {
      const [, digit, label] = OPENING.exec(chunk) ?? [];
      const change = label ? modeLabelChange(label, digit ?? null) : null;
      if (!change) {
        return false;
      }
      this.entries.push({ label, mode: composeMode(this.mode, change) });
      return true;
    }
    const label = CLOSING.exec(chunk)?.[1];
    if (label === undefined || chunk.startsWith('{')) {
      return false;
    }
    if (label === '') {
      // A bare `}` closes the innermost span (`{crescendo … }`).
      if (this.entries.length > 1) {
        this.entries.pop();
        return true;
      }
      return false;
    }
    const at = this.entries.findLastIndex(
      (entry) => entry.label !== null && sameLabel(entry.label, label)
    );
    if (at < 1) {
      return false;
    }
    this.entries.length = at;
    return true;
  }
}

/**
 * Mode spans in IPA word indexes from the mode of each word (the mode
 * open at its first phone) and the words written with `ˈˈ`: neighbouring
 * words with equal modes form one span, and a word with `ˈˈ` is a span of
 * its own with `emphasis` 1.
 * @param {Map<number, object>} wordModes word index -> mode
 * @param {Set<number>} emphasized word indexes
 * @returns {{from: number, to: number, mode: object}[]}
 */
export function wordSpans(wordModes, emphasized) {
  const spans = [];
  let key = null;
  const words = [...wordModes.keys()].sort((left, right) => left - right);
  for (const word of words) {
    let mode = wordModes.get(word);
    const strong = emphasized.has(word);
    if (strong) {
      mode = composeMode(mode, { emphasis: 1 });
    }
    if (isDefaultMode(mode)) {
      key = null;
      continue;
    }
    const next = strong ? null : modeKey(mode);
    const last = spans.at(-1);
    if (next !== null && next === key && last?.to === word) {
      last.to = word + 1;
    } else {
      spans.push({ from: word, to: word + 1, mode });
    }
    key = next;
  }
  return spans;
}

const near = (value, target) => Math.abs(value - target) < 1e-6;

/** Degree digit of a degree: `1` for 0.33, none for 0.67, `3` for 1. */
function degreeDigit(degree) {
  if (near(degree, 0.33)) {
    return '1';
  }
  if (near(degree, 0.67)) {
    return '';
  }
  return near(degree, 1) ? '3' : null;
}

const EFFORT_LABELS = [
  [0, 'pp'],
  [0.25, 'p'],
  [0.75, 'f'],
  [1, 'ff'],
];

function effortLabels(mode, labels) {
  const effort = EFFORT_LABELS.find(([value]) => near(mode.effort, value));
  if (effort) {
    labels.push(effort[1]);
  }
  const ramp = mode.effortEnd - mode.effort;
  if (near(ramp, 0.25)) {
    labels.push('crescendo');
  } else if (near(ramp, -0.25)) {
    labels.push('diminuendo');
  }
}

/** Phonation fields with an ExtIPA/VoQS label: [field, sign, label]. */
const PHONATION_LABELS = [
  ['breathy', 1, 'V̤'],
  ['creaky', 1, 'V̰'],
  ['tension', 1, 'V͈'],
  ['tension', -1, 'V͉'],
  ['falsetto', 1, 'F'],
  ['harsh', 1, 'V!'],
];

const WHISPERY_DIGITS = [
  [0.25, '1'],
  [0.5, ''],
  [0.75, '3'],
];

function phonationLabels(phonation, labels) {
  if (near(phonation.whisper, 1)) {
    labels.push('W');
  } else {
    const whispery = WHISPERY_DIGITS.find(([value]) =>
      near(phonation.whisper, value)
    );
    if (whispery) {
      labels.push(`${whispery[1]}Ṿ`);
    }
  }
  for (const [field, sign, label] of PHONATION_LABELS) {
    const value = sign * phonation[field];
    const digit = value > 0 ? degreeDigit(value) : null;
    if (digit !== null) {
      labels.push(`${digit}${label}`);
    }
  }
}

/**
 * The brace labels that write a mode, outermost first: effort, a
 * crescendo or diminuendo, tempo, phonation and the tune (`{IK4`). Fields without an
 * ExtIPA/VoQS symbol (pitch, range, gain, emotion, lang, emphasis other
 * than 1) and values between the degrees are not written.
 * @param {object} mode
 * @returns {string[]} labels with their degree digit, e.g. `3V̤`
 */
export function modeLabels(mode) {
  const labels = [];
  effortLabels(mode, labels);
  if (near(mode.rate, 1.3)) {
    labels.push('allegro');
  } else if (near(mode.rate, 0.75)) {
    labels.push('lento');
  }
  phonationLabels(mode.phonation ?? MODE_DEFAULTS.phonation, labels);
  if (mode.tune) {
    labels.push(mode.tune);
  }
  return labels;
}

/** The closing chunk of a label: crescendo and diminuendo close with `}`. */
function closingChunk(label) {
  const name = label.replace(/^[123]/u, '');
  return name === 'crescendo' || name === 'diminuendo' ? '}' : `${name}}`;
}

/** Write `ˈˈ` on a word: double its first primary stress or prefix one. */
function emphasize(text) {
  if (text.includes('ˈˈ')) {
    return text;
  }
  return text.includes('ˈ') ? text.replace('ˈ', 'ˈˈ') : `ˈˈ${text}`;
}

/**
 * Write the marks of `modes` over the pieces of an IPA string. A piece is
 * `{text, word}`: `word` is the IPA word index of its first word and
 * `count` (default 1 for a word, 0 otherwise) the number of words it holds;
 * pauses and sounds have `word` -1. The marks of a span open before its
 * first word and close after its last one; a span with `emphasis` 1 writes
 * `ˈˈ` on each of its words.
 * @param {{text: string, word: number, count?: number}[]} pieces
 * @param {{from: number, to: number, mode: object}[]} modes
 * @returns {string[]} the pieces and the mark chunks, in order
 */
export function writeMarks(pieces, modes = []) {
  const before = new Map();
  const after = new Map();
  const strong = new Set();
  const located = pieces.map((piece) => {
    const count = piece.count ?? (piece.word >= 0 ? 1 : 0);
    return { ...piece, last: piece.word + count - 1, count };
  });
  for (const span of modes) {
    const first = located.findIndex(
      (piece) => piece.count > 0 && piece.last >= span.from
    );
    const last = located.findLastIndex(
      (piece) => piece.count > 0 && piece.word < span.to
    );
    if (first < 0 || last < first) {
      continue;
    }
    const labels = modeLabels(span.mode);
    before.set(first, [
      ...(before.get(first) ?? []),
      ...labels.map((label) => `{${label}`),
    ]);
    after.set(last, [
      ...labels.map(closingChunk).reverse(),
      ...(after.get(last) ?? []),
    ]);
    if (span.mode.emphasis === 1) {
      for (let index = first; index <= last; index++) {
        strong.add(index);
      }
    }
  }
  const parts = [];
  located.forEach((piece, index) => {
    parts.push(...(before.get(index) ?? []));
    parts.push(strong.has(index) ? emphasize(piece.text) : piece.text);
    parts.push(...(after.get(index) ?? []));
  });
  return parts;
}
