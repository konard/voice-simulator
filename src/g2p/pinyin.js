/**
 * Hanyu Pinyin to IPA.
 *
 * Accepts tone marks (hǎo) or tone numbers (hao3, neutral 5 or no number).
 * Initials map to Standard Mandarin consonants, finals are rewritten for
 * y/w spellings and j/q/x + u = ü, and tones become Chao tone letters.
 */

const INITIALS = [
  ['zh', 'ʈ͡ʂ'],
  ['ch', 'ʈ͡ʂʰ'],
  ['sh', 'ʂ'],
  ['b', 'p'],
  ['p', 'pʰ'],
  ['m', 'm'],
  ['f', 'f'],
  ['d', 't'],
  ['t', 'tʰ'],
  ['n', 'n'],
  ['l', 'l'],
  ['g', 'k'],
  ['k', 'kʰ'],
  ['h', 'x'],
  ['j', 't͡ɕ'],
  ['q', 't͡ɕʰ'],
  ['x', 'ɕ'],
  ['r', 'ʐ'],
  ['z', 't͡s'],
  ['c', 't͡sʰ'],
  ['s', 's'],
];

const FINALS = {
  a: 'a',
  o: 'wo',
  e: 'ɤ',
  ê: 'ɛ',
  ai: 'aɪ',
  ei: 'eɪ',
  ao: 'ɑʊ',
  ou: 'oʊ',
  an: 'an',
  en: 'ən',
  ang: 'ɑŋ',
  eng: 'əŋ',
  ong: 'ʊŋ',
  er: 'ɚ',
  i: 'i',
  ia: 'ja',
  ie: 'jɛ',
  iao: 'jɑʊ',
  iu: 'joʊ',
  iou: 'joʊ',
  ian: 'jɛn',
  in: 'in',
  iang: 'jɑŋ',
  ing: 'iŋ',
  iong: 'jʊŋ',
  u: 'u',
  ua: 'wa',
  uo: 'wo',
  uai: 'waɪ',
  ui: 'weɪ',
  uei: 'weɪ',
  uan: 'wan',
  un: 'wən',
  uen: 'wən',
  uang: 'wɑŋ',
  ueng: 'wəŋ',
  ü: 'y',
  üe: 'ɥɛ',
  üan: 'ɥɛn',
  ün: 'yn',
};

/** y/w spellings rewritten to the underlying final. */
const ZERO_INITIAL = {
  yi: 'i',
  ya: 'ia',
  ye: 'ie',
  yao: 'iao',
  you: 'iou',
  yan: 'ian',
  yin: 'in',
  yang: 'iang',
  ying: 'ing',
  yong: 'iong',
  yu: 'ü',
  yue: 'üe',
  yuan: 'üan',
  yun: 'ün',
  wu: 'u',
  wa: 'ua',
  wo: 'uo',
  wai: 'uai',
  wei: 'uei',
  wan: 'uan',
  wen: 'uen',
  wang: 'uang',
  weng: 'ueng',
};

const TONE_MARKS = {
  '̄': 1,
  '́': 2,
  '̌': 3,
  '̀': 4,
};

/** Tone contours as Chao letters; the third tone is shortened mid-phrase. */
export const TONE_CONTOURS = {
  1: '˥',
  2: '˧˥',
  3: '˨˩˦',
  halfThird: '˨˩',
  4: '˥˩',
  5: '',
};

/**
 * Split a syllable like `hǎo`, `hao3` or `lü4` into letters and tone.
 * @param {string} syllable
 * @returns {{letters: string, tone: number}|null}
 */
export function splitTone(syllable) {
  let tone = 5;
  let letters = '';
  for (const char of syllable.toLowerCase().normalize('NFD')) {
    if (TONE_MARKS[char]) {
      tone = TONE_MARKS[char];
    } else if (char === '̈') {
      letters += '̈';
    } else if (/[1-5]/.test(char)) {
      tone = Number(char);
    } else {
      letters += char;
    }
  }
  letters = letters.normalize('NFC').replaceAll('v', 'ü').replaceAll('u:', 'ü');
  return /^[a-zêü]+$/.test(letters) ? { letters, tone } : null;
}

function splitInitial(letters) {
  const initial = INITIALS.find(([spelling]) => letters.startsWith(spelling));
  if (!initial) {
    return {
      initial: '',
      initialIpa: '',
      final: ZERO_INITIAL[letters] ?? letters,
    };
  }
  return {
    initial: initial[0],
    initialIpa: initial[1],
    final: letters.slice(initial[0].length),
  };
}

function finalIpa(initial, final) {
  if (final === 'i' && /^(?:z|c|s)$/.test(initial)) {
    return 'ɹ̩';
  }
  if (final === 'i' && /^(?:zh|ch|sh|r)$/.test(initial)) {
    return 'ɻ̩';
  }
  const palatal = /^[jqx]$/.test(initial);
  const resolved = palatal ? final.replace(/^u/, 'ü') : final;
  if (/^[bpmf]$/.test(initial) && resolved === 'o') {
    return 'wo';
  }
  return FINALS[resolved] ?? null;
}

/**
 * Convert a single toned pinyin syllable to IPA segments and tone.
 * @param {string} syllable
 * @returns {{ipa: string, tone: number, base: string}|null}
 */
export function pinyinSyllableToIpa(syllable) {
  const parsed = splitTone(syllable);
  if (!parsed) {
    return null;
  }
  const { initial, initialIpa, final } = splitInitial(parsed.letters);
  const vowel = finalIpa(initial, final);
  if (!vowel) {
    return null;
  }
  return {
    ipa: `${initialIpa}${vowel}`,
    tone: parsed.tone,
    base: parsed.letters,
  };
}

/**
 * Apply Mandarin tone sandhi to a phrase of syllables in place.
 * - 3 3 -> 2 3
 * - 不 bù before a 4th tone -> bú
 * - 一 yī -> yí before 4th tone, yì before 1st/2nd/3rd (not phrase-final)
 * @param {{tone: number, base: string, char?: string}[]} syllables
 */
export function applyToneSandhi(syllables) {
  for (let index = 0; index < syllables.length - 1; index++) {
    const current = syllables[index];
    const next = syllables[index + 1];
    if (current.char === '不' && next.tone === 4) {
      current.tone = 2;
    } else if (current.char === '一' && next.tone === 4) {
      current.tone = 2;
    } else if (current.char === '一' && next.tone !== 5) {
      current.tone = 4;
    }
  }
  for (let index = syllables.length - 2; index >= 0; index--) {
    if (syllables[index].tone === 3 && syllables[index + 1].tone === 3) {
      syllables[index].tone = 2;
    }
  }
  return syllables;
}

/**
 * Render a syllable with Chao tone letters.
 * @param {{ipa: string, tone: number}} syllable
 * @param {boolean} phraseFinal
 */
export function syllableWithTone(syllable, phraseFinal) {
  const tone =
    syllable.tone === 3 && !phraseFinal ? 'halfThird' : syllable.tone;
  return `${syllable.ipa}${TONE_CONTOURS[tone] ?? ''}`;
}

/**
 * Split running pinyin such as `ni3hao3` or `nǐhǎo` into syllables.
 * Uses greedy longest-match against valid syllables.
 * @param {string} text
 * @returns {string[]|null}
 */
export function segmentPinyin(text) {
  const syllables = [];
  const pattern = /[a-zêüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜv:]+[1-5]?/giu;
  for (const match of text.normalize('NFC').matchAll(pattern)) {
    const parts = segmentWord(match[0]);
    if (!parts) {
      return null;
    }
    syllables.push(...parts);
  }
  return syllables.length ? syllables : null;
}

function segmentWord(word) {
  if (!word) {
    return [];
  }
  for (let length = Math.min(7, word.length); length > 0; length--) {
    let end = length;
    if (/[1-5]/.test(word[end] ?? '')) {
      end++;
    }
    const head = word.slice(0, end);
    if (!pinyinSyllableToIpa(head)) {
      continue;
    }
    const rest = segmentWord(word.slice(end));
    if (rest) {
      return [head, ...rest];
    }
  }
  return null;
}
