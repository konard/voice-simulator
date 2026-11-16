/**
 * vslex: a compact container for sorted pronunciation lexicons (issue 47).
 *
 *   {format: 'vslex', version: 1, lang, count, blockSize: 64, alphabet,
 *    symbols, values, first, blocks}
 *
 * Words are lower case and sorted by code point. They are cut into blocks
 * of `blockSize` entries; `first[i]` is the first word of `blocks[i]`.
 * Inside a block each entry is front coded (Witten, Moffat and Bell,
 * Managing Gigabytes, 2nd ed., section 4.1):
 *
 *   <digit: code points shared with the previous word, 0..9; 0 at the
 *    start of a block> <the rest of the word> <pronunciation>
 *   [/ <pronunciation of a further variant>]...
 *
 * Word characters are listed in `alphabet` (anything but digits, `/` and
 * the space; `don't` keeps its apostrophe). A pronunciation is written in
 * `symbols`, printable ASCII characters that are neither digits, `/`,
 * quotes, the backslash nor characters of `alphabet`; symbol i stands for
 * the string `values[i]`. The first character after the word that is not
 * in `alphabet` therefore starts the pronunciation.
 *
 * A lookup does a binary search in `first` and decodes one block, which
 * is cached.
 */

const DIGITS = '0123456789';
/** Characters that are never symbols. */
const RESERVED = new Set([...DIGITS, '/', '"', "'", '`', '\\', ' ']);
/** Characters a word may not contain (they delimit entries). */
const NOT_IN_WORDS = new Set([...DIGITS, '/', ' ']);
const MAX_PREFIX = 9;

/** Printable ASCII characters that may be symbols next to `alphabet`. */
export function symbolCandidates(alphabet) {
  const used = new Set(alphabet);
  const candidates = [];
  for (let code = 0x21; code < 0x7f; code++) {
    const char = String.fromCharCode(code);
    if (!RESERVED.has(char) && !used.has(char)) {
      candidates.push(char);
    }
  }
  return candidates;
}

/** Compare two strings by code point (not by UTF-16 code unit). */
export function compareCodePoints(left, right) {
  const a = [...left];
  const b = [...right];
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) {
      return a[index].codePointAt(0) - b[index].codePointAt(0);
    }
  }
  return a.length - b.length;
}

function sharedPrefix(previous, word) {
  const length = Math.min(previous.length, word.length, MAX_PREFIX);
  let shared = 0;
  while (shared < length && previous[shared] === word[shared]) {
    shared++;
  }
  return shared;
}

function pairKey(left, right) {
  return `${left}\u0000${right}`;
}

/**
 * Merge the most frequent neighbouring units while symbols are left over
 * (byte-pair encoding, Gage 1994). Deterministic: ties go to the pair
 * that sorts first.
 */
function mergeUnits(sequences, spare) {
  const merges = [];
  let current = sequences;
  for (let round = 0; round < spare; round++) {
    const counts = new Map();
    for (const units of current) {
      for (let index = 0; index + 1 < units.length; index++) {
        const key = pairKey(units[index], units[index + 1]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let best = null;
    let bestCount = 2;
    for (const [key, count] of counts) {
      if (count > bestCount || (count === bestCount && best && key < best)) {
        best = key;
        bestCount = count;
      }
    }
    if (!best) {
      break;
    }
    const [left, right] = best.split('\u0000');
    merges.push(left + right);
    current = current.map((units) => {
      const merged = [];
      for (let index = 0; index < units.length; index++) {
        if (
          index + 1 < units.length &&
          units[index] === left &&
          units[index + 1] === right
        ) {
          merged.push(left + right);
          index++;
        } else {
          merged.push(units[index]);
        }
      }
      return merged;
    });
  }
  return { merges, sequences: current };
}

/**
 * Build a vslex container.
 * @param {string} lang
 * @param {Map<string, string[]>|Array<[string, string[]]>} entries word ->
 *   pronunciations (variants in order)
 * @param {{units?: (text: string) => string[], merge?: boolean,
 *   blockSize?: number}} [options] `units` splits a pronunciation into the
 *   strings that get one symbol each (default: code points); `merge` uses
 *   the symbols left over for frequent pairs of units
 * @returns {object}
 */
export function encodeVslex(lang, entries, options = {}) {
  const { units = (text) => [...text], merge = true, blockSize = 64 } = options;
  const sorted = [...entries]
    .map(([word, variants]) => [word, [...new Set(variants)]])
    .sort(([left], [right]) => compareCodePoints(left, right));
  const alphabetSet = new Set();
  sorted.forEach(([word], index) => {
    if (word !== word.toLowerCase()) {
      throw new TypeError(`vslex: "${word}" is not lower case`);
    }
    if (index > 0 && sorted[index - 1][0] === word) {
      throw new TypeError(`vslex: "${word}" appears twice`);
    }
    for (const char of word) {
      if (NOT_IN_WORDS.has(char)) {
        throw new TypeError(`vslex: "${word}" contains "${char}"`);
      }
      alphabetSet.add(char);
    }
  });
  const alphabet = [...alphabetSet].sort(compareCodePoints).join('');
  const candidates = symbolCandidates(alphabet);
  const split = sorted.map(([, variants]) => variants.map(units));
  const flat = split.flat();
  const base = [...new Set(flat.flat())].sort(compareCodePoints);
  if (base.length > candidates.length) {
    throw new RangeError(
      `vslex: ${base.length} pronunciation units but only ${candidates.length} symbols`
    );
  }
  const { merges, sequences } = merge
    ? mergeUnits(flat, candidates.length - base.length)
    : { merges: [], sequences: flat };
  const values = [...base, ...merges];
  const symbols = candidates.slice(0, values.length).join('');
  const symbolOf = new Map(values.map((value, index) => [value, symbols[index]]));
  let cursor = 0;
  const first = [];
  const blocks = [];
  let block = '';
  let previous = [];
  sorted.forEach(([word], index) => {
    const letters = [...word];
    const atStart = index % blockSize === 0;
    if (atStart && index > 0) {
      blocks.push(block);
      block = '';
    }
    if (atStart) {
      first.push(word);
    }
    const shared = atStart ? 0 : sharedPrefix(previous, letters);
    const pronunciations = split[index].map(() =>
      sequences[cursor++].map((unit) => symbolOf.get(unit)).join('')
    );
    block += `${shared}${letters.slice(shared).join('')}${pronunciations.join('/')}`;
    previous = letters;
  });
  if (sorted.length > 0) {
    blocks.push(block);
  }
  return {
    format: 'vslex',
    version: 1,
    lang,
    count: sorted.length,
    blockSize,
    alphabet,
    symbols,
    values,
    first,
    blocks,
  };
}

/** True for an object in the vslex format. */
export function isVslex(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    data.format === 'vslex' &&
    data.version === 1
  );
}

/**
 * Decode one block into [word, pronunciations[]] pairs.
 * @param {object} data a vslex container
 * @param {number} index block number
 */
export function decodeBlock(data, index, tables = blockTables(data)) {
  const { letters, valueOf } = tables;
  const entries = [];
  let previous = [];
  let word = null;
  let variants = null;
  let pronunciation = '';
  const finish = () => {
    if (word !== null) {
      variants.push(pronunciation);
      entries.push([word.join(''), variants]);
    }
  };
  let inWord = false;
  for (const char of data.blocks[index]) {
    if (DIGITS.includes(char)) {
      finish();
      word = previous.slice(0, Number(char));
      previous = word;
      variants = [];
      pronunciation = '';
      inWord = true;
    } else if (inWord && letters.has(char)) {
      word.push(char);
    } else if (char === '/') {
      inWord = false;
      variants.push(pronunciation);
      pronunciation = '';
    } else {
      inWord = false;
      const value = valueOf.get(char);
      if (value === undefined) {
        throw new TypeError(
          `vslex ${data.lang}: unknown symbol "${char}" in block ${index}`
        );
      }
      pronunciation += value;
    }
  }
  finish();
  return entries;
}

/** The lookup tables of a container (alphabet set and symbol values). */
export function blockTables(data) {
  return {
    letters: new Set(data.alphabet),
    valueOf: new Map([...data.symbols].map((symbol, i) => [symbol, data.values[i]])),
  };
}

/** Index of the block that would hold `word`, or -1. */
export function findBlock(data, word) {
  let low = 0;
  let high = data.first.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (compareCodePoints(data.first[middle], word) <= 0) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
