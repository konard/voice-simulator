/**
 * Syllabification of parsed IPA.
 *
 * Each word is cut at its nuclei (vowels and syllabic consonants). The
 * consonants between two nuclei go to the second syllable as long as
 * they form an onset the language allows (maximal onset), and a stress
 * mark, which the transcriptions write at the start of a syllable, always
 * starts a new one. Onsets follow the sonority sequencing principle with
 * per-language tweaks:
 *
 * - English: sonority must rise, `s` may start a cluster (`str`), no
 *   `ŋ`, `tl`/`dl` or `sr` onsets.
 * - Russian: sonority must not fall, so obstruent clusters such as `zv`
 *   and `fs` stay together (ˈzvu.kə.vɨx).
 * - Hindi: one consonant plus an optional glide (nə.məs.t̪eː).
 * - Mandarin: one consonant plus a glide; consecutive vowels belong to one
 *   syllable up to the vowel that carries the tone.
 */

import { formatIpa, parseIpa } from './parse.js';

/** Vowel pairs written as two tokens that form one nucleus. */
const DIPHTHONGS = new Set(
  ['eɪ aɪ oʊ aʊ ɔɪ əʊ əʉ æɪ ɑe æɔ ɑɪ ɑʊ', 'ɪə ɛə ʊə eə ɔə', 'ai ei au ou oi']
    .join(' ')
    .split(' ')
);

const GLIDES = new Set(['j', 'w', 'ɥ', 'ɰ', 'ʋ']);

const MANNER_SONORITY = {
  plosive: 1,
  fricative: 2,
  'lateral-fricative': 2,
  nasal: 3,
  trill: 4,
  tap: 4,
  'lateral-approximant': 4,
  approximant: 4,
};

/** Sonority of a consonant token: stops 1 up to glides 5. */
export function sonority(token) {
  if (token.syllabic) {
    return 6;
  }
  if (GLIDES.has(token.base)) {
    return 5;
  }
  if (token.affricate) {
    return 1.5;
  }
  return MANNER_SONORITY[token.phoneme?.manner] ?? 2;
}

function rising(onset, { plateau }) {
  return onset.every(
    (token, index) =>
      index === 0 ||
      (plateau
        ? sonority(token) >= sonority(onset[index - 1])
        : sonority(token) > sonority(onset[index - 1]))
  );
}

const S_CLUSTER = (onset) =>
  onset[0].base === 's' &&
  onset.length > 1 &&
  sonority(onset[1]) <= 3 &&
  rising(onset.slice(1), { plateau: false });

const ENGLISH_BANNED = /^(?:ŋ|[td]l|sɹ|.*ŋ)/u;

/** Whether `onset` (a list of consonant tokens) can start a syllable. */
const ONSETS = {
  en: (onset) =>
    !ENGLISH_BANNED.test(onset.map((token) => token.base).join('')) &&
    (rising(onset, { plateau: false }) || S_CLUSTER(onset)),
  ru: (onset) => rising(onset, { plateau: true }),
  hi: (onset) =>
    onset.length === 1 || (onset.length === 2 && GLIDES.has(onset[1].base)),
  zh: (onset) =>
    onset.length === 1 || (onset.length === 2 && GLIDES.has(onset[1].base)),
  default: (onset) => rising(onset, { plateau: false }) || S_CLUSTER(onset),
};

/** Whether the vowel at `index` joins the nucleus before it. */
function joinsNucleus(tokens, index, tonal) {
  const token = tokens[index];
  const previous = tokens[index - 1];
  if (!previous?.syllabic || !token.syllabic || token.kind !== 'vowel') {
    return false;
  }
  if (token.syllableStart || token.stress) {
    return false;
  }
  if (tonal) {
    return !previous.tone;
  }
  return !token.long && DIPHTHONGS.has(`${previous.base}${token.base}`);
}

/** Nuclei of one word as `[first, last]` token index ranges. */
function nuclei(tokens, tonal) {
  const ranges = [];
  tokens.forEach((token, index) => {
    if (joinsNucleus(tokens, index, tonal)) {
      ranges.at(-1)[1] = index;
    } else if (token.syllabic) {
      ranges.push([index, index]);
    }
  });
  return ranges;
}

/** Index where the syllable after the consonants `from..to-1` starts. */
function onsetStart(tokens, from, to, allowed) {
  for (let index = from; index < to; index++) {
    if (tokens[index].syllableStart) {
      return index;
    }
  }
  let start = to;
  while (start > from && allowed(tokens.slice(start - 1, to))) {
    start--;
  }
  return start;
}

/**
 * Split the segment tokens of one word into syllables.
 * @param {object[]} tokens Tokens of one word (no pauses).
 * @param {{language?: string}} [options]
 * @returns {object[][]} Tokens per syllable.
 */
export function syllabifyTokens(tokens, options = {}) {
  const tonal = tokens.some((token) => token.tone);
  const allowed =
    ONSETS[String(options.language ?? '').slice(0, 2)] ?? ONSETS.default;
  const ranges = nuclei(tokens, tonal);
  if (ranges.length < 2) {
    return tokens.length ? [tokens] : [];
  }
  const starts = [0];
  for (let index = 1; index < ranges.length; index++) {
    starts.push(
      onsetStart(tokens, ranges[index - 1][1] + 1, ranges[index][0], allowed)
    );
  }
  return starts.map((start, index) =>
    tokens.slice(start, starts[index + 1] ?? tokens.length)
  );
}

/**
 * IPA of one syllable with its stress mark in front.
 * @param {object[]} tokens
 */
export function syllableIpa(tokens) {
  const stress = tokens.find((token) => token.stress)?.stress;
  const mark = stress === 1 ? 'ˈ' : stress === 2 ? 'ˌ' : '';
  const plain = tokens.map((token) => ({ ...token, stress: 0, tone: null }));
  const tones = tokens.flatMap((token) => token.tone ?? []);
  // Tone letters close the syllable, as Mandarin transcriptions write them.
  return (
    mark + formatIpa(plain) + formatIpa([{ ...TONE_CARRIER, tone: tones }])
  );
}

const TONE_CARRIER = { kind: 'vowel', symbol: '', stress: 0 };

/**
 * Syllabify an IPA string word by word.
 * @param {string} ipa
 * @param {{language?: string}} [options]
 * @returns {string[][]} Syllables (as IPA) of each word.
 */
export function syllabifyIpa(ipa, options = {}) {
  const words = new Map();
  for (const token of parseIpa(ipa).tokens) {
    if (token.kind !== 'pause') {
      words.set(token.word, [...(words.get(token.word) ?? []), token]);
    }
  }
  return [...words.values()].map((tokens) =>
    syllabifyTokens(tokens, options).map(syllableIpa)
  );
}
