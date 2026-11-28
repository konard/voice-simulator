/**
 * Distances between two transcripts: Levenshtein (1966) edit distance and
 * the word, character and phoneme error rates (WER, CER, PER).
 */

import { parseIpa } from '../ipa/parse.js';

const MATCH = 0;
const SUBSTITUTE = 1;
const DELETE = 2;
const INSERT = 3;

/** Count the edits along one cheapest path, including the matrix edges. */
function traceEdits(steps, i, j, onPair) {
  const counts = { substitutions: 0, deletions: 0, insertions: 0 };
  const width = j;
  while (i > 0 || j > 0) {
    const cell = (i - 1) * width + j - 1;
    const step =
      j === 0
        ? DELETE
        : i === 0
          ? INSERT
          : (steps[Math.floor(cell / 4)] >>> ((cell & 3) * 2)) & 3;
    if (step === DELETE) {
      counts.deletions++;
      i--;
    } else if (step === INSERT) {
      counts.insertions++;
      j--;
    } else {
      counts.substitutions += step === SUBSTITUTE ? 1 : 0;
      i--;
      j--;
      onPair?.(i, j);
    }
  }
  return counts;
}

/**
 * Levenshtein distance between two token lists, each substitution,
 * deletion and insertion costing 1. The trace back prefers a match or a
 * substitution, then a deletion, then an insertion.
 * @param {ArrayLike<unknown>} reference
 * @param {ArrayLike<unknown>} hypothesis
 * @returns {{distance: number, substitutions: number, deletions: number, insertions: number}}
 */
export function editDistance(reference, hypothesis) {
  return measureEdits(reference, hypothesis);
}

/** Levenshtein counts and the index pairs of matches and substitutions. */
export function alignEdits(reference, hypothesis) {
  const pairs = [];
  const counts = measureEdits(reference, hypothesis, (i, j) =>
    pairs.push([i, j])
  );
  return { ...counts, pairs: pairs.reverse() };
}

function measureEdits(reference, hypothesis, onPair) {
  const n = reference.length;
  const m = hypothesis.length;
  // Hold only the current cost row and pack four traceback choices per byte.
  const cost = new Uint32Array(m + 1);
  const steps = new Uint8Array(Math.ceil((n * m) / 4));
  for (let j = 0; j <= m; j++) {
    cost[j] = j;
  }
  let cell = 0;
  for (let i = 1; i <= n; i++) {
    let diagonal = cost[0];
    cost[0] = i;
    for (let j = 1; j <= m; j++) {
      const above = cost[j];
      const same = reference[i - 1] === hypothesis[j - 1];
      let step = same ? MATCH : SUBSTITUTE;
      let best = diagonal + (same ? 0 : 1);
      if (above + 1 < best) {
        step = DELETE;
        best = above + 1;
      }
      if (cost[j - 1] + 1 < best) {
        step = INSERT;
        best = cost[j - 1] + 1;
      }
      cost[j] = best;
      diagonal = above;
      steps[Math.floor(cell / 4)] |= step << ((cell & 3) * 2);
      cell++;
    }
  }
  return { distance: cost[m], ...traceEdits(steps, n, m, onPair) };
}

function cleanText(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '');
}

/**
 * Split a text into tokens.
 * - `word`: Unicode NFC, lower case, punctuation (\p{P}) and symbols (\p{S})
 *   removed, split on white space;
 * - `char`: the same, then white space removed, one token per code point;
 * - `phone`: IPA parsed with `parseIpa`, one token per vowel or consonant
 *   (its symbol with length mark and diacritics); stress marks, tone
 *   letters, pauses and boundaries are dropped.
 * @param {string} text
 * @param {'word'|'char'|'phone'} [unit]
 * @returns {string[]}
 */
export function tokenize(text, unit = 'word') {
  if (unit === 'word') {
    return cleanText(text).split(/\s+/u).filter(Boolean);
  }
  if (unit === 'char') {
    return Array.from(cleanText(text).replace(/\s+/gu, ''));
  }
  if (unit === 'phone') {
    return parseIpa(text)
      .tokens.filter(
        (token) => token.kind === 'vowel' || token.kind === 'consonant'
      )
      .map((token) => token.symbol);
  }
  throw new RangeError(`Unknown unit "${unit}" (use word, char or phone)`);
}

/**
 * Error rate of a hypothesis against a reference: the word (WER), character
 * (CER) or phoneme (PER) error rate depending on `unit`.
 * @param {string|ArrayLike<unknown>} reference Text or token list.
 * @param {string|ArrayLike<unknown>} hypothesis Text or token list.
 * @param {'word'|'char'|'phone'} [unit]
 * @returns {{distance: number, substitutions: number, deletions: number, insertions: number, referenceLength: number, rate: number}}
 *   rate = distance / max(1, referenceLength).
 */
export function errorRate(reference, hypothesis, unit = 'word') {
  const tokens = (value) =>
    typeof value === 'string' ? tokenize(value, unit) : Array.from(value);
  const ref = tokens(reference);
  const result = editDistance(ref, tokens(hypothesis));
  return {
    ...result,
    referenceLength: ref.length,
    rate: result.distance / Math.max(1, ref.length),
  };
}
