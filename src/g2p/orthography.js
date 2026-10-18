/**
 * Map spoken syllables back to the letters that spell them, so a reader
 * can highlight the syllable being spoken inside the written word.
 *
 * - Mandarin: one Han character per syllable (exact).
 * - Hindi: one akshara per pronounced vowel; an akshara whose inherent
 *   schwa is deleted joins the syllable before it (exact up to the
 *   schwa-deletion rule shared with `hindi.js`).
 * - Russian: one vowel letter per syllable; the consonant letters between
 *   two vowels are shared out like the spoken coda and onset.
 * - English: vowel letter groups aligned with the nuclei (`alignVowels`),
 *   doubled consonants split in the middle, otherwise shared out like
 *   the spoken coda and onset. When the groups cannot be aligned, the
 *   letters are shared out by the number of phones.
 */

import { vowelGroups } from './spelling.js';

const HAN = /\p{Script=Han}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const RUSSIAN_VOWELS = /[аеёиоуыэюя]/i;

/** Han characters of a word, one per syllable. */
function hanSpans(word, count) {
  const spans = [];
  let offset = 0;
  for (const char of word) {
    if (HAN.test(char)) {
      spans.push({ start: offset, end: offset + char.length });
    }
    offset += char.length;
  }
  return spans.length === count ? spans : null;
}

const DEVANAGARI = {
  letter: /[\u0900-\u097F]/u,
  consonant: /[\u0915-\u0939\u0958-\u095F]/u,
  vowel: /[\u0904-\u0914\u0960\u0961]/u,
  matra: /[\u093E-\u094C\u0962\u0963]/u,
  virama: '\u094D',
  nukta: '\u093C',
  anusvara: '\u0902',
};

/** Split a Devanagari word into aksharas with their vowel status. */
export function hindiAksharas(word) {
  const aksharas = [];
  const chars = [...word];
  let offset = 0;
  let current = null;
  for (const char of chars) {
    const joinsConjunct = current?.virama && DEVANAGARI.consonant.test(char);
    if (joinsConjunct) {
      current.consonants++;
      current.virama = false;
    } else if (DEVANAGARI.consonant.test(char) || DEVANAGARI.vowel.test(char)) {
      current = {
        start: offset,
        end: offset,
        consonants: DEVANAGARI.consonant.test(char) ? 1 : 0,
        inherent: DEVANAGARI.consonant.test(char),
        virama: false,
        anusvara: false,
      };
      aksharas.push(current);
    } else if (current) {
      markAkshara(current, char);
    }
    offset += char.length;
    if (current) {
      current.end = offset;
    }
  }
  return deleteAksharaSchwas(aksharas);
}

function markAkshara(akshara, char) {
  if (DEVANAGARI.matra.test(char)) {
    akshara.inherent = false;
  } else if (char === DEVANAGARI.virama) {
    akshara.virama = true;
  } else if (char === DEVANAGARI.anusvara) {
    akshara.anusvara = true;
    akshara.inherent = false;
  }
}

/**
 * Mark which aksharas keep a vowel, with the same word-final and medial
 * (V C _ C V) schwa deletion as `deleteSchwas` in `hindi.js`.
 */
function deleteAksharaSchwas(aksharas) {
  for (const akshara of aksharas) {
    akshara.voiced = !akshara.virama;
  }
  const last = aksharas.at(-1);
  if (last?.inherent && aksharas.filter((a) => a.voiced).length > 1) {
    last.voiced = false;
  }
  for (let index = aksharas.length - 2; index >= 1; index--) {
    const akshara = aksharas[index];
    const previous = aksharas[index - 1];
    const next = aksharas[index + 1];
    const deletable =
      akshara.inherent &&
      akshara.voiced &&
      akshara.consonants === 1 &&
      previous.voiced &&
      !previous.anusvara &&
      next.consonants === 1 &&
      next.voiced;
    if (deletable) {
      akshara.voiced = false;
      index--;
    }
  }
  return aksharas;
}

/** Aksharas grouped by pronounced vowel, one group per syllable. */
function aksharaSpans(word, count) {
  const spans = [];
  for (const akshara of hindiAksharas(word)) {
    if (akshara.voiced || !spans.length) {
      spans.push({ start: akshara.start, end: akshara.end });
    } else {
      spans.at(-1).end = akshara.end;
    }
  }
  if (spans.length !== count) {
    return null;
  }
  spans.at(-1).end = word.length;
  return spans;
}

/** Russian vowel letters, each one a syllable nucleus. */
function russianNuclei(word) {
  return [...word.matchAll(new RegExp(RUSSIAN_VOWELS.source, 'gi'))].map(
    (match) => ({ start: match.index, end: match.index + 1 })
  );
}

/** English vowel letter groups; keeps a final `e` if it is spoken. */
function englishNuclei(word, count) {
  const groups = vowelGroups(word);
  if (groups.length === count) {
    return groups;
  }
  const spoken = [...word.toLowerCase().matchAll(/[aeiouy]+/g)].map(
    (match) => ({ start: match.index, end: match.index + match[0].length })
  );
  return spoken.length === count ? spoken : null;
}

/**
 * Where the syllable after `left` starts between two nucleus letter
 * groups: a doubled consonant is split in the middle, other consonant
 * letters are shared out like the spoken coda and onset.
 */
function boundary(word, left, right, phones) {
  const lower = word.toLowerCase();
  for (let index = left.end + 1; index < right.start; index++) {
    if (lower[index] === lower[index - 1]) {
      return index;
    }
  }
  const letters = right.start - left.end;
  const total = phones.coda + phones.onset;
  const onset = total ? Math.round((letters * phones.onset) / total) : 0;
  return right.start - onset;
}

function nucleusSpans(word, nuclei, phones) {
  return nuclei.map((nucleus, index) => ({
    start:
      index === 0
        ? 0
        : boundary(word, nuclei[index - 1], nucleus, phones[index]),
    end:
      index === nuclei.length - 1
        ? word.length
        : boundary(word, nucleus, nuclei[index + 1], phones[index + 1]),
  }));
}

/** Share the letters out by the number of phones of each syllable. */
function proportionalSpans(word, sizes) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let used = 0;
  return sizes.map((size, index) => {
    const start = Math.round((used / total) * word.length);
    used += size;
    const end =
      index === sizes.length - 1
        ? word.length
        : Math.round((used / total) * word.length);
    return { start, end };
  });
}

/**
 * Letter ranges of each syllable of a written word, by its script.
 * @param {string} word The written word.
 * @param {{coda: number, onset: number, size: number}[]} syllables Phone
 *   counts of each syllable: consonants before the nucleus (`onset`),
 *   after it (`coda`) and in total (`size`).
 * @param {{exactOnly?: boolean}} [options] Skip the proportional fallback.
 * @returns {{start: number, end: number}[]|null} Offsets within `word`.
 */
export function syllableSpans(word, syllables, options = {}) {
  const count = syllables.length;
  if (!word || !count) {
    return null;
  }
  if (HAN.test(word)) {
    return hanSpans(word, count);
  }
  if (DEVANAGARI.letter.test(word)) {
    return aksharaSpans(word, count);
  }
  if (count === 1) {
    return [{ start: 0, end: word.length }];
  }
  const nuclei = CYRILLIC.test(word)
    ? russianNuclei(word)
    : englishNuclei(word, count);
  if (nuclei?.length === count) {
    const phones = syllables.map((syllable, index) => ({
      onset: syllable.onset,
      coda: syllables[index - 1]?.coda ?? 0,
    }));
    return nucleusSpans(word, nuclei, phones);
  }
  if (options.exactOnly || word.length < count) {
    return null;
  }
  return proportionalSpans(
    word,
    syllables.map((syllable) => syllable.size)
  );
}
