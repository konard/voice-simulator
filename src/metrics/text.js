/**
 * Distances between two transcripts: Levenshtein (1966) edit distance and
 * the word, character and phoneme error rates (WER, CER, PER).
 */

import { parseIpa } from '../ipa/parse.js';

/** Count the edits along one cheapest path through the cost matrix. */
function traceEdits(cost, width, reference, hypothesis, onPair) {
  const counts = { substitutions: 0, deletions: 0, insertions: 0 };
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 || j > 0) {
    const here = cost[i * width + j];
    const same = i > 0 && j > 0 && reference[i - 1] === hypothesis[j - 1];
    if (i > 0 && j > 0 && cost[(i - 1) * width + j - 1] + !same === here) {
      counts.substitutions += same ? 0 : 1;
      onPair?.(i - 1, j - 1, same);
      i--;
      j--;
    } else if (i > 0 && cost[(i - 1) * width + j] + 1 === here) {
      counts.deletions++;
      i--;
    } else {
      counts.insertions++;
      j--;
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

/** Internal alignment using the same tie-breaking as the error-rate metrics. */
export function alignedTokenPairs(reference, hypothesis) {
  const pairs = [];
  measureEdits(reference, hypothesis, (ref, hyp, same) => {
    pairs.push({ ref, hyp, same });
  });
  return pairs.reverse();
}

function measureEdits(reference, hypothesis, onPair) {
  const n = reference.length;
  const m = hypothesis.length;
  const width = m + 1;
  const cost = new Uint32Array((n + 1) * width);
  for (let j = 0; j <= m; j++) {
    cost[j] = j;
  }
  for (let i = 1; i <= n; i++) {
    cost[i * width] = i;
    for (let j = 1; j <= m; j++) {
      const same = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      cost[i * width + j] = Math.min(
        cost[(i - 1) * width + j - 1] + same,
        cost[(i - 1) * width + j] + 1,
        cost[i * width + j - 1] + 1
      );
    }
  }
  const counts = traceEdits(cost, width, reference, hypothesis, onPair);
  return { distance: cost[n * width + m], ...counts };
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
