/**
 * English letter-to-sound fallback and number spelling.
 *
 * Used only for words missing from the generated CMUdict subset. The rules
 * are ordered grapheme patterns matched greedily from left to right with a
 * small amount of context (silent final e, soft c/g), which is enough to
 * keep unknown names and neologisms pronounceable.
 */

const VOWEL_LETTERS = 'aeiouy';

/** [grapheme, ipa, condition?] where condition sees (word, index, length). */
const RULES = [
  ['tch', 't͡ʃ'],
  ['augh', 'ɔ'],
  ['ough', 'oʊ'],
  ['eigh', 'eɪ'],
  ['igh', 'aɪ'],
  ['tion', 'ʃən'],
  ['sion', 'ʒən'],
  ['ture', 't͡ʃɚ'],
  ['ph', 'f'],
  ['sh', 'ʃ'],
  ['ch', 't͡ʃ'],
  ['th', 'θ'],
  ['wh', 'w'],
  ['ck', 'k'],
  ['ng', 'ŋ'],
  ['qu', 'kw'],
  ['dg', 'd͡ʒ'],
  ['kn', 'n', (word, index) => index === 0],
  ['wr', 'ɹ', (word, index) => index === 0],
  ['gh', 'ɡ', (word, index) => index === 0],
  ['gh', ''],
  [
    'ed',
    'ɪd',
    (word, index) => isEnding(word, index, 2) && 'td'.includes(word[index - 1]),
  ],
  ['ed', 'd', (word, index) => isEnding(word, index, 2) && index > 2],
  [
    'es',
    'ɪz',
    (word, index) =>
      isEnding(word, index, 2) && 'sxz'.includes(word[index - 1]),
  ],
  ['es', 'z', (word, index) => isEnding(word, index, 2) && index > 2],
  ['ee', 'i'],
  ['ea', 'i'],
  ['oo', 'u'],
  ['ou', 'aʊ'],
  ['ow', 'aʊ', (word, index, length) => index + length === word.length],
  ['ow', 'oʊ'],
  ['oa', 'oʊ'],
  ['oi', 'ɔɪ'],
  ['oy', 'ɔɪ'],
  ['ai', 'eɪ'],
  ['ay', 'eɪ'],
  ['au', 'ɔ'],
  ['aw', 'ɔ'],
  ['ew', 'ju'],
  ['ie', 'i'],
  ['ei', 'eɪ'],
  ['ey', 'i', (word, index, length) => index + length === word.length],
  ['ar', 'ɑɹ'],
  ['er', 'ɚ'],
  ['ir', 'ɝ'],
  ['ur', 'ɝ'],
  ['or', 'ɔɹ'],
  ['c', 's', (word, index) => 'eiy'.includes(word[index + 1] ?? '')],
  ['g', 'd͡ʒ', (word, index) => 'ei'.includes(word[index + 1] ?? '')],
  ['e', '', isSilentE],
  ['y', 'i', (word, index) => index > 0 && index === word.length - 1],
  ['y', 'j', (word, index) => index === 0],
  ['y', 'ɪ'],
  ['a', 'eɪ', isMagicE],
  ['e', 'i', isMagicE],
  ['i', 'aɪ', isMagicE],
  ['o', 'oʊ', isMagicE],
  ['u', 'u', isMagicE],
  ['a', 'æ'],
  ['e', 'ɛ'],
  ['i', 'ɪ'],
  ['o', 'ɑ'],
  ['u', 'ʌ'],
  ['b', 'b'],
  ['c', 'k'],
  ['d', 'd'],
  ['f', 'f'],
  ['g', 'ɡ'],
  ['h', 'h'],
  ['j', 'd͡ʒ'],
  ['k', 'k'],
  ['l', 'l'],
  ['m', 'm'],
  ['n', 'n'],
  ['p', 'p'],
  ['q', 'k'],
  ['r', 'ɹ'],
  ['s', 's'],
  ['t', 't'],
  ['v', 'v'],
  ['w', 'w'],
  ['x', 'ks'],
  ['z', 'z'],
  ["'", ''],
];

function isEnding(word, index, length) {
  return index + length === word.length;
}

function isSilentE(word, index) {
  return (
    index === word.length - 1 &&
    index > 1 &&
    [...word.slice(0, index)].some((letter) => VOWEL_LETTERS.includes(letter))
  );
}

/** Vowel followed by one consonant and a silent final e (make, time). */
function isMagicE(word, index) {
  const next = word[index + 1];
  return (
    next !== undefined &&
    !VOWEL_LETTERS.includes(next) &&
    word[index + 2] === 'e' &&
    index + 2 === word.length - 1
  );
}

/**
 * Pronounce an out-of-vocabulary word with spelling rules.
 * @param {string} word lowercase word
 * @returns {string} IPA
 */
export function spellToIpa(word) {
  const phones = [];
  let index = 0;
  while (index < word.length) {
    const rule = RULES.find(
      ([grapheme, , condition]) =>
        word.startsWith(grapheme, index) &&
        (!condition || condition(word, index, grapheme.length))
    );
    if (!rule) {
      index++;
      continue;
    }
    phones.push(rule[1]);
    index += rule[0].length;
  }
  const ipa = phones.join('');
  return /[aeiouæɑɛɪʌɔʊɚɝə]/.test(ipa) ? `ˈ${ipa}` : ipa;
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

const SCALES = [
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
  [100, 'hundred'],
];

/**
 * Spell a non-negative integer in English words.
 * @param {number} value
 * @returns {string[]}
 */
export function englishNumberWords(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return [...String(value)].map((digit) => ONES[Number(digit)] ?? '');
  }
  if (value < 20) {
    return [ONES[value]];
  }
  if (value < 100) {
    const rest = value % 10;
    return [TENS[Math.floor(value / 10)], ...(rest ? [ONES[rest]] : [])];
  }
  for (const [scale, name] of SCALES) {
    if (value >= scale) {
      const rest = value % scale;
      return [
        ...englishNumberWords(Math.floor(value / scale)),
        name,
        ...(rest ? englishNumberWords(rest) : []),
      ];
    }
  }
  return [];
}
