/**
 * IPA symbol inventory with articulatory features.
 *
 * The International Phonetic Alphabet is organised by articulation: every
 * consonant is a (place, manner, voicing) triple and every vowel is a
 * (height, backness, rounding) point. That is exactly the information the
 * 3D model needs, so the inventory below is the bridge between text and
 * tongue/lip/velum positions.
 *
 * Vowel coordinates use the IPA vowel chart: height 1 = close, 0 = open;
 * backness 0 = front, 1 = back.
 */

/** Height values of the IPA vowel chart rows. */
const H = {
  close: 1,
  nearClose: 0.83,
  closeMid: 0.67,
  mid: 0.5,
  openMid: 0.33,
  nearOpen: 0.17,
  open: 0,
};

/** Backness values of the IPA vowel chart columns. */
const B = { front: 0, nearFront: 0.2, central: 0.5, nearBack: 0.8, back: 1 };

function vowel(symbol, height, backness, rounded, name) {
  return Object.freeze({
    symbol,
    kind: 'vowel',
    height,
    backness,
    rounded,
    voiced: true,
    name,
  });
}

export const VOWELS = Object.freeze(
  Object.fromEntries(
    [
      vowel('i', H.close, B.front, false, 'close front unrounded'),
      vowel('y', H.close, B.front, true, 'close front rounded'),
      vowel('ɨ', H.close, B.central, false, 'close central unrounded'),
      vowel('ʉ', H.close, B.central, true, 'close central rounded'),
      vowel('ɯ', H.close, B.back, false, 'close back unrounded'),
      vowel('u', H.close, B.back, true, 'close back rounded'),
      vowel('ɪ', H.nearClose, B.nearFront, false, 'near-close front unrounded'),
      vowel('ʏ', H.nearClose, B.nearFront, true, 'near-close front rounded'),
      vowel('ʊ', H.nearClose, B.nearBack, true, 'near-close back rounded'),
      vowel('e', H.closeMid, B.front, false, 'close-mid front unrounded'),
      vowel('ø', H.closeMid, B.front, true, 'close-mid front rounded'),
      vowel('ɘ', H.closeMid, B.central, false, 'close-mid central unrounded'),
      vowel('ɵ', H.closeMid, B.central, true, 'close-mid central rounded'),
      vowel('ɤ', H.closeMid, B.back, false, 'close-mid back unrounded'),
      vowel('o', H.closeMid, B.back, true, 'close-mid back rounded'),
      vowel('ə', H.mid, B.central, false, 'mid central (schwa)'),
      vowel('ɚ', H.mid, B.central, false, 'r-coloured schwa'),
      vowel('ɛ', H.openMid, B.front, false, 'open-mid front unrounded'),
      vowel('œ', H.openMid, B.front, true, 'open-mid front rounded'),
      vowel('ɜ', H.openMid, B.central, false, 'open-mid central unrounded'),
      vowel('ɝ', H.openMid, B.central, false, 'r-coloured open-mid central'),
      vowel('ɞ', H.openMid, B.central, true, 'open-mid central rounded'),
      vowel('ʌ', H.openMid, B.back, false, 'open-mid back unrounded'),
      vowel('ɔ', H.openMid, B.back, true, 'open-mid back rounded'),
      vowel('æ', H.nearOpen, B.front, false, 'near-open front unrounded'),
      vowel('ɐ', H.nearOpen, B.central, false, 'near-open central'),
      vowel('a', H.open, B.front, false, 'open front unrounded'),
      vowel('ɶ', H.open, B.front, true, 'open front rounded'),
      vowel('ä', H.open, B.central, false, 'open central unrounded'),
      vowel('ɑ', H.open, B.back, false, 'open back unrounded'),
      vowel('ɒ', H.open, B.back, true, 'open back rounded'),
    ].map((entry) => [entry.symbol, entry])
  )
);

function consonant(symbol, place, manner, voiced, extra = {}) {
  return Object.freeze({
    symbol,
    kind: 'consonant',
    place,
    manner,
    voiced,
    ...extra,
  });
}

/** Pulmonic consonants plus common co-articulated ones. */
export const CONSONANTS = Object.freeze(
  Object.fromEntries(
    [
      consonant('p', 'bilabial', 'plosive', false),
      consonant('b', 'bilabial', 'plosive', true),
      consonant('t', 'alveolar', 'plosive', false),
      consonant('d', 'alveolar', 'plosive', true),
      consonant('ʈ', 'retroflex', 'plosive', false),
      consonant('ɖ', 'retroflex', 'plosive', true),
      consonant('c', 'palatal', 'plosive', false),
      consonant('ɟ', 'palatal', 'plosive', true),
      consonant('k', 'velar', 'plosive', false),
      consonant('g', 'velar', 'plosive', true),
      consonant('ɡ', 'velar', 'plosive', true),
      consonant('q', 'uvular', 'plosive', false),
      consonant('ɢ', 'uvular', 'plosive', true),
      consonant('ʔ', 'glottal', 'plosive', false),
      consonant('m', 'bilabial', 'nasal', true),
      consonant('ɱ', 'labiodental', 'nasal', true),
      consonant('n', 'alveolar', 'nasal', true),
      consonant('ɳ', 'retroflex', 'nasal', true),
      consonant('ɲ', 'palatal', 'nasal', true),
      consonant('ŋ', 'velar', 'nasal', true),
      consonant('ɴ', 'uvular', 'nasal', true),
      consonant('ʙ', 'bilabial', 'trill', true),
      consonant('r', 'alveolar', 'trill', true),
      consonant('ʀ', 'uvular', 'trill', true),
      consonant('ⱱ', 'labiodental', 'tap', true),
      consonant('ɾ', 'alveolar', 'tap', true),
      consonant('ɽ', 'retroflex', 'tap', true),
      consonant('ɸ', 'bilabial', 'fricative', false),
      consonant('β', 'bilabial', 'fricative', true),
      consonant('f', 'labiodental', 'fricative', false),
      consonant('v', 'labiodental', 'fricative', true),
      consonant('θ', 'dental', 'fricative', false),
      consonant('ð', 'dental', 'fricative', true),
      consonant('s', 'alveolar', 'fricative', false, { sibilant: true }),
      consonant('z', 'alveolar', 'fricative', true, { sibilant: true }),
      consonant('ʃ', 'postalveolar', 'fricative', false, { sibilant: true }),
      consonant('ʒ', 'postalveolar', 'fricative', true, { sibilant: true }),
      consonant('ʂ', 'retroflex', 'fricative', false, { sibilant: true }),
      consonant('ʐ', 'retroflex', 'fricative', true, { sibilant: true }),
      consonant('ɕ', 'alveolopalatal', 'fricative', false, { sibilant: true }),
      consonant('ʑ', 'alveolopalatal', 'fricative', true, { sibilant: true }),
      consonant('ç', 'palatal', 'fricative', false),
      consonant('ʝ', 'palatal', 'fricative', true),
      consonant('x', 'velar', 'fricative', false),
      consonant('ɣ', 'velar', 'fricative', true),
      consonant('χ', 'uvular', 'fricative', false),
      consonant('ʁ', 'uvular', 'fricative', true),
      consonant('ħ', 'pharyngeal', 'fricative', false),
      consonant('ʕ', 'pharyngeal', 'fricative', true),
      consonant('h', 'glottal', 'fricative', false),
      consonant('ɦ', 'glottal', 'fricative', true),
      consonant('ɬ', 'alveolar', 'lateral-fricative', false),
      consonant('ɮ', 'alveolar', 'lateral-fricative', true),
      consonant('ʋ', 'labiodental', 'approximant', true),
      consonant('ɹ', 'alveolar', 'approximant', true),
      consonant('ɻ', 'retroflex', 'approximant', true),
      consonant('j', 'palatal', 'approximant', true),
      consonant('ɰ', 'velar', 'approximant', true),
      consonant('w', 'labial-velar', 'approximant', true),
      consonant('ʍ', 'labial-velar', 'fricative', false),
      consonant('ɥ', 'labial-palatal', 'approximant', true),
      consonant('l', 'alveolar', 'lateral-approximant', true),
      consonant('ɫ', 'alveolar', 'lateral-approximant', true, {
        velarized: true,
      }),
      consonant('ɭ', 'retroflex', 'lateral-approximant', true),
      consonant('ʎ', 'palatal', 'lateral-approximant', true),
      consonant('ʟ', 'velar', 'lateral-approximant', true),
    ].map((entry) => [entry.symbol, entry])
  )
);

/** Combining and modifier marks understood by the parser. */
export const DIACRITICS = Object.freeze({
  ʰ: 'aspirated',
  ʱ: 'breathy',
  ʲ: 'palatalized',
  ʷ: 'labialized',
  ˠ: 'velarized',
  ˤ: 'pharyngealized',
  ⁿ: 'nasalRelease',
  ː: 'long',
  ˑ: 'halfLong',
  '̃': 'nasalized',
  '̥': 'voiceless',
  '̊': 'voiceless',
  '̬': 'voiced',
  '̩': 'syllabic',
  '̍': 'syllabic',
  '̯': 'nonSyllabic',
  '̪': 'dental',
  '̞': 'lowered',
  '̝': 'raised',
  '̈': 'centralized',
  '̠': 'retracted',
  '̟': 'advanced',
  '˞': 'rhotic',
  '͡': 'tie',
  '͜': 'tie',
  // Voice quality of a single phone (VoQS): breathy, creaky, whispered.
  '\u0324': 'breathyVoice',
  '\u0330': 'creaky',
  '\u0323': 'whispered',
});

/** Chao tone letters, 5 = highest pitch. */
export const TONE_LETTERS = Object.freeze({
  '˥': 5,
  '˦': 4,
  '˧': 3,
  '˨': 2,
  '˩': 1,
});

export const STRESS_MARKS = Object.freeze({ ˈ: 1, ˌ: 2 });

/** Pause symbols and their relative lengths. */
export const PAUSES = Object.freeze({
  ' ': 0,
  '.': 3,
  '|': 2,
  '‖': 3,
  ',': 2,
  ';': 2,
  ':': 2,
  '!': 3,
  '?': 3,
  '…': 3,
  '(': 2,
  ')': 2,
  '"': 1,
});

/**
 * Prosodic boundary class of each pause symbol, ranked from weakest to
 * strongest: when pauses merge (`, "` or `?!`) the stronger class wins.
 */
export const BOUNDARY_CLASSES = Object.freeze({
  ' ': 'word',
  '"': 'quote',
  '(': 'paren',
  ')': 'paren',
  ',': 'comma',
  '|': 'dash',
  ';': 'semicolon',
  ':': 'semicolon',
  '…': 'ellipsis',
  '.': 'period',
  '‖': 'period',
  '!': 'exclamation',
  '?': 'question',
});

/** Rank of each boundary class (higher wins a merge). */
export const BOUNDARY_RANKS = Object.freeze(
  Object.fromEntries(
    [
      'word',
      'quote',
      'paren',
      'comma',
      'dash',
      'semicolon',
      'ellipsis',
      'period',
      'exclamation',
      'question',
    ].map((name, rank) => [name, rank])
  )
);

/** Intonation arrows: global rise and fall for the next phrase end. */
export const CONTOUR_MARKS = Object.freeze({ '↗': 'rise', '↘': 'fall' });

/**
 * Look up a base IPA symbol.
 * @param {string} symbol
 */
export function getPhoneme(symbol) {
  return VOWELS[symbol] ?? CONSONANTS[symbol] ?? null;
}

/** All base symbols the simulator can articulate. */
export function listSymbols() {
  return [...Object.keys(VOWELS), ...Object.keys(CONSONANTS)];
}

/** Degree of the ExtIPA/VoQS degree digits 1, 2 (or none) and 3. */
const LABEL_DEGREES = Object.freeze({ 1: 0.33, 2: 0.67, 3: 1 });

const effortLabel = (effort) => () => ({ effort });
const phonationLabel =
  (name, sign = 1) =>
  (degree) => ({
    phonation: { [name]: sign * degree },
  });

/**
 * Labels of the ExtIPA/VoQS brace spans `{label … label}` and the change
 * of mode (src/markup/modes.js) each makes at a degree: the degree digit
 * 1, 2 (or none) and 3 before the label gives 0.33, 0.67 and 1
 * (`{3V̤ … V̤}`). `digit` is the digit written, or null.
 */
export const MODE_LABELS = Object.freeze({
  pp: effortLabel(0),
  '𝆏𝆏': effortLabel(0),
  p: effortLabel(0.25),
  '𝆏': effortLabel(0.25),
  f: effortLabel(0.75),
  '𝆑': effortLabel(0.75),
  ff: effortLabel(1),
  '𝆑𝆑': effortLabel(1),
  crescendo: () => ({ effortRamp: 0.25 }),
  diminuendo: () => ({ effortRamp: -0.25 }),
  allegro: () => ({ rate: 1.3, absolute: ['rate'] }),
  lento: () => ({ rate: 0.75, absolute: ['rate'] }),
  'V\u0324': phonationLabel('breathy'),
  'V\u0330': phonationLabel('creaky'),
  C: () => ({ phonation: { creaky: 1 } }),
  'V\u0348': phonationLabel('tension'),
  'V\u0349': phonationLabel('tension', -1),
  F: phonationLabel('falsetto'),
  'V!': phonationLabel('harsh'),
  W: (degree, digit) => ({
    phonation: { whisper: 1 },
    ...(digit === '1' ? { effort: 0.25 } : {}),
    ...(digit === '3' ? { effort: 0.75 } : {}),
  }),
  '\u1e7e': (degree) => ({
    phonation: { whisper: { 0.33: 0.25, 0.67: 0.5, 1: 0.75 }[degree] },
  }),
  V: () => ({
    phonation: {
      breathy: 0,
      creaky: 0,
      tension: 0,
      falsetto: 0,
      harsh: 0,
      whisper: 0,
    },
  }),
});

/** The change of a mode label with an optional degree digit, or null. */
export function modeLabelChange(label, digit = null) {
  const key = Object.keys(MODE_LABELS).find(
    (name) => name.normalize('NFD') === label.normalize('NFD')
  );
  if (!key) {
    return null;
  }
  return MODE_LABELS[key](LABEL_DEGREES[digit ?? 2], digit);
}
