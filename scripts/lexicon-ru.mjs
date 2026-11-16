/**
 * The Russian stress data of issue 48: parse data/lexicon/ru-stress.txt
 * and derive the guess table of `guessStress()` in src/g2p/russian.js.
 *
 * One item per line, `+` before the stressed vowel, `#` starts a comment:
 *
 *   раб+от|а     a stem with fixed stress; `|` ends the stem, the letters
 *                after it are the dictionary ending (работа, работы ...).
 *   стол|+       a stem with stress on the ending: the first vowel of the
 *   хорош|+о     ending, or the last vowel of the stem when the ending has
 *                none (стол, стола́, столу́).
 *   =час+ов      a whole form.
 *
 * A `ё` is stressed when no `+` is written (`=ещё`, `зелён|ый`).
 */

const VOWELS = 'аеёиоуыэюя';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const vowelCount = (text) =>
  [...text].filter((char) => VOWELS.includes(char)).length;

/** The index among the vowels of the `+`, or of the first `ё`. */
function markedVowel(marked, line) {
  const plus = marked.indexOf('+');
  if (plus >= 0) {
    if (
      marked.indexOf('+', plus + 1) >= 0 ||
      !VOWELS.includes(marked[plus + 1] ?? '')
    ) {
      throw new TypeError(
        `ru-stress.txt: "${line}" needs one + before a vowel`
      );
    }
    return vowelCount(marked.slice(0, plus));
  }
  const yo = marked.indexOf('ё');
  return yo >= 0 ? vowelCount(marked.slice(0, yo)) : -1;
}

/**
 * Parse one item of ru-stress.txt.
 * @param {string} line without comment
 * @returns {{kind: 'form', word: string, payload: string, stress: number}
 *   | {kind: 'stem', stem: string, ending: string, payload: string,
 *      word: string, stress: number}}
 *   `payload` is the lexicon value: for a form the stressed vowel as a
 *   letter (`a` the first, `z` the last of two or more), for a stem the
 *   stressed vowel of the stem or `+` for the ending; `word` and `stress`
 *   are the dictionary form and the index of its stressed vowel.
 */
export function parseRussianItem(line) {
  const item = line.normalize('NFC').toLowerCase();
  if (!/^(?:=[а-яё+]+|[а-яё+]+\|\+?[а-яё]*)$/u.test(item)) {
    throw new TypeError(`ru-stress.txt: "${line}" is not an item`);
  }
  return item.startsWith('=')
    ? parseForm(item.slice(1), line)
    : parseStem(item, line);
}

function parseForm(marked, line) {
  const word = marked.replace('+', '');
  const vowels = vowelCount(word);
  const stress = markedVowel(marked, line);
  if (stress < 0 && vowels > 1) {
    throw new TypeError(`ru-stress.txt: "${line}" has no stress`);
  }
  const index = Math.max(stress, 0);
  const payload = index === vowels - 1 && vowels > 1 ? 'z' : LETTERS[index];
  return { kind: 'form', word, payload, stress: index };
}

function parseStem(item, line) {
  const [markedStem, markedEnding] = item.split('|');
  const stem = markedStem.replace('+', '');
  const ending = markedEnding.replace('+', '');
  const onEnding = markedEnding.startsWith('+');
  const stemStress = onEnding ? -1 : markedVowel(markedStem, line);
  if (onEnding ? markedStem.includes('+') : stemStress < 0) {
    throw new TypeError(`ru-stress.txt: "${line}" needs one +`);
  }
  if (onEnding && vowelCount(stem + ending) === 0) {
    throw new TypeError(`ru-stress.txt: "${line}" has no vowel`);
  }
  const stress = onEnding
    ? vowelCount(stem) - (vowelCount(ending) > 0 ? 0 : 1)
    : stemStress;
  return {
    kind: 'stem',
    stem,
    ending,
    payload: onEnding ? '+' : LETTERS[stemStress],
    word: stem + ending,
    stress,
  };
}

function addOnce(map, key, payload, line) {
  const known = map.get(key);
  if (known !== undefined && known !== payload) {
    throw new TypeError(`ru-stress.txt: "${line}" contradicts an earlier item`);
  }
  map.set(key, payload);
}

/**
 * Read ru-stress.txt.
 * @param {string} text
 * @returns {{forms: Map<string, string>, stems: Map<string, string>,
 *   words: Map<string, number>}} forms and stems with their payloads, and
 *   every whole form and dictionary form with its stressed vowel.
 */
export function readRussianStress(text) {
  const forms = new Map();
  const stems = new Map();
  const words = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/u, '').trim();
    if (!line) {
      continue;
    }
    const item = parseRussianItem(line);
    if (item.kind === 'form') {
      addOnce(forms, item.word, item.payload, line);
    } else {
      addOnce(stems, item.stem, item.payload, line);
    }
    if (!words.has(item.word) || item.kind === 'form') {
      words.set(item.word, item.stress);
    }
  }
  return { forms, stems, words };
}

/**
 * The words the guess table is counted on, sorted by code point: whole
 * forms and dictionary forms with two or more vowels and no `ё` (a typed
 * or restored `ё` is stressed before the guess). Every fifth word
 * (index 4, 9, ...) is held out as a test word.
 * @param {Map<string, number>} words
 * @returns {{counted: [string, number][], heldOut: [string, number][]}}
 */
export function splitGuessWords(words) {
  const usable = [...words]
    .filter(([word]) => !word.includes('ё') && vowelCount(word) > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    counted: usable.filter((_, index) => index % 5 !== 4),
    heldOut: usable.filter((_, index) => index % 5 === 4),
  };
}

/**
 * The guess table: for every word ending of 2 to `longest` (6) letters shared by at
 * least `minWords` words, the stress counted from the end (0 the last
 * vowel), kept when at least `agree` of the words have it. Endings whose
 * guess equals the guess of their longest shorter ending (or of the
 * default, the vowel before the last) are dropped.
 * @param {[string, number][]} words word and stressed vowel
 * @returns {string[]} element i lists the endings with stress i from the end
 */
export function russianGuessTable(
  words,
  { minWords = 5, agree = 0.6, longest = 6 } = {}
) {
  const counts = new Map();
  for (const [word, stress] of words) {
    const fromEnd = vowelCount(word) - 1 - stress;
    for (let length = 2; length <= longest && length < word.length; length++) {
      const ending = word.slice(-length);
      const row = counts.get(ending) ?? new Map();
      row.set(fromEnd, (row.get(fromEnd) ?? 0) + 1);
      counts.set(ending, row);
    }
  }
  const kept = new Map();
  for (const [ending, row] of counts) {
    const total = [...row.values()].reduce((sum, count) => sum + count, 0);
    const [best, count] = [...row].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0]
    )[0];
    if (total >= minWords && count >= agree * total) {
      kept.set(ending, best);
    }
  }
  const inherited = (ending) => {
    for (let length = ending.length - 1; length >= 2; length--) {
      if (kept.has(ending.slice(-length))) {
        return kept.get(ending.slice(-length));
      }
    }
    return 1;
  };
  const table = [];
  for (const ending of [...kept.keys()].sort()) {
    const fromEnd = kept.get(ending);
    if (fromEnd !== inherited(ending)) {
      table[fromEnd] = [...(table[fromEnd] ?? []), ending];
    }
  }
  return Array.from(table, (endings) => (endings ?? []).join(' '));
}
