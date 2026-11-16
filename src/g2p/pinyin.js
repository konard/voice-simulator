/**
 * Hanyu Pinyin to IPA.
 *
 * Accepts tone marks (hǎo) or tone numbers (hao3, neutral 5 or no number).
 * Initials map to Standard Mandarin consonants, finals are rewritten for
 * y/w spellings and j/q/x + u = ü, and tones become Chao tone letters.
 * Erhua (`huār`, `hua1r`, `huar1`) is one syllable whose rime ends in the
 * consonant ɻ, with the rime taken from `ERHUA_FINALS`.
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

export const FINALS = {
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

/**
 * Rimes of the finals with the erhua suffix (Duanmu 2007, Lin 2007): a
 * final `i` glide or `n` is dropped, `ng` is dropped and nasalises the
 * vowel, and the high vowels `i` and `ü` become glides before `əɻ`.
 * Sources differ in the vowel of `ie`, `üe` and `o`; correct them here.
 * The apical vowel (`zi`, `shi`) is handled in `erhuaIpa`.
 */
export const ERHUA_FINALS = {
  a: 'aɻ',
  ai: 'aɻ',
  an: 'aɻ',
  ia: 'jaɻ',
  ian: 'jaɻ',
  ua: 'waɻ',
  uai: 'waɻ',
  uan: 'waɻ',
  üan: 'ɥaɻ',
  ang: 'ɑ̃ɻ',
  iang: 'jɑ̃ɻ',
  uang: 'wɑ̃ɻ',
  e: 'ɤɻ',
  ei: 'əɻ',
  en: 'əɻ',
  ui: 'wəɻ',
  uei: 'wəɻ',
  un: 'wəɻ',
  uen: 'wəɻ',
  eng: 'ə̃ɻ',
  ueng: 'wə̃ɻ',
  i: 'jəɻ',
  in: 'jəɻ',
  ing: 'jə̃ɻ',
  ü: 'ɥəɻ',
  ün: 'ɥəɻ',
  ie: 'jɛɻ',
  üe: 'ɥɛɻ',
  o: 'woɻ',
  uo: 'woɻ',
  ao: 'ɑʊɻ',
  iao: 'jɑʊɻ',
  ou: 'oʊɻ',
  iu: 'joʊɻ',
  iou: 'joʊɻ',
  u: 'uɻ',
  ong: 'ʊ̃ɻ',
  iong: 'jʊ̃ɻ',
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

const APICAL_INITIALS = /^(?:z|c|s|zh|ch|sh|r)$/;

function finalIpa(initial, final) {
  if (final === 'i' && /^(?:z|c|s)$/.test(initial)) {
    return 'ɹ̩';
  }
  if (final === 'i' && /^(?:zh|ch|sh|r)$/.test(initial)) {
    return 'ɻ̩';
  }
  return FINALS[resolveFinal(initial, final)] ?? null;
}

/** The final as written in the tables: j/q/x + u = ü, b/p/m/f + o = uo. */
function resolveFinal(initial, final) {
  const palatal = /^[jqx]$/.test(initial);
  const resolved = palatal ? final.replace(/^u/, 'ü') : final;
  return /^[bpmf]$/.test(initial) && resolved === 'o' ? 'uo' : resolved;
}

/**
 * IPA of a syllable with the erhua suffix: the initial consonant plus the
 * r-coloured rime of `ERHUA_FINALS` (`əɻ` for the apical vowel).
 * @param {string} initial Pinyin initial (`'zh'`, `'h'`) or `''`.
 * @param {string} final Pinyin final without the `r` (`'ua'`, `'i'`).
 * @returns {string|null} `null` when the final has no erhua form.
 */
export function erhuaIpa(initial, final) {
  const initialIpa =
    INITIALS.find(([spelling]) => spelling === initial)?.[1] ?? '';
  if (final === 'i' && APICAL_INITIALS.test(initial)) {
    return `${initialIpa}əɻ`;
  }
  const rime = ERHUA_FINALS[resolveFinal(initial, final)];
  return rime ? `${initialIpa}${rime}` : null;
}

/**
 * Convert a single toned pinyin syllable to IPA segments and tone.
 * A syllable with the erhua suffix (`huār`, `huar1`, `hua1r`) gives one
 * syllable with an r-coloured rime and `erhua: true`.
 * @param {string} syllable
 * @returns {{ipa: string, tone: number, base: string, erhua?: true}|null}
 */
export function pinyinSyllableToIpa(syllable) {
  const parsed = splitTone(syllable);
  if (!parsed) {
    return null;
  }
  const { initial, initialIpa, final } = splitInitial(parsed.letters);
  const vowel = finalIpa(initial, final);
  if (vowel) {
    return {
      ipa: `${initialIpa}${vowel}`,
      tone: parsed.tone,
      base: parsed.letters,
    };
  }
  return erhuaSyllable(parsed);
}

function erhuaSyllable({ letters, tone }) {
  if (!letters.endsWith('r') || letters === 'er') {
    return null;
  }
  const host = splitInitial(letters.slice(0, -1));
  if (!finalIpa(host.initial, host.final)) {
    return null;
  }
  const ipa = erhuaIpa(host.initial, host.final);
  return ipa ? { ipa, tone, base: letters, erhua: true } : null;
}

/**
 * Words in which 一 keeps its first tone yī (issue 49): ordinal and
 * calendar uses that are not counted.
 */
export const YI_FIRST_TONE_WORDS = Object.freeze([
  '一月',
  '一号',
  '一楼',
  '一班',
  '一等',
  '一级',
  '一流',
  '一年级',
]);

/** Characters before 一 that make it an ordinal or a digit: 第一, 十一. */
const YI_ORDINAL_BEFORE = new Set('第十初〇零二三四五六七八九');
/** Digits after 一: a number read digit by digit (一九九一). */
const YI_DIGIT_AFTER = new Set('〇零一二三四五六七八九');

/** Whether the 一 at `index` keeps its first tone. */
function keepsFirstTone(syllables, index) {
  const previous = syllables[index - 1];
  const next = syllables[index + 1];
  if (YI_ORDINAL_BEFORE.has(previous?.char) || YI_DIGIT_AFTER.has(next?.char)) {
    return true;
  }
  const text = syllables
    .slice(index)
    .map((syllable) => syllable.char ?? '')
    .join('');
  return YI_FIRST_TONE_WORDS.some((word) => text.startsWith(word));
}

/**
 * Tone of the 一 or 不 at `index` (not the last syllable) by its
 * neighbours, or `undefined` when it keeps its tone.
 */
function yiBuTone(syllables, index) {
  const current = syllables[index];
  const yi = current.char === '一';
  if (!yi && current.char !== '不') {
    return undefined;
  }
  const previous = syllables[index - 1];
  const next = syllables[index + 1];
  if (next.char && previous?.char === next.char) {
    return 5;
  }
  if (!yi) {
    return next.tone === 4 ? 2 : undefined;
  }
  if (keepsFirstTone(syllables, index)) {
    return undefined;
  }
  if (next.tone === 4) {
    return 2;
  }
  return next.tone === 5 ? undefined : 4;
}

/**
 * Apply Mandarin tone sandhi to a phrase of syllables in place.
 * - 一 and 不 between two equal characters are neutral: 看一看, 是不是
 * - 一 keeps yī after 第, 十, 初 or a digit, before a digit and in the
 *   words of `YI_FIRST_TONE_WORDS`: 第一名, 十一月, 一九九一, 一月
 * - 不 bù before a 4th tone -> bú
 * - 一 yī -> yí before 4th tone, yì before 1st/2nd/3rd (not phrase-final)
 * - 3 3 -> 2 3
 * The rules of 一 and 不 need the source character (`char`): typed pinyin
 * (`bu4`, `yi1`) has none and keeps the tone that was typed.
 * @param {{tone: number, base: string, char?: string}[]} syllables
 */
export function applyToneSandhi(syllables) {
  for (let index = 0; index < syllables.length - 1; index++) {
    const tone = yiBuTone(syllables, index);
    if (tone !== undefined) {
      syllables[index].tone = tone;
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

const LETTERS = '[a-zêüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜv:]';

/** Letters and a tone digit; an `r` after the digit ends the word. */
const PINYIN_WORD = new RegExp(
  `${LETTERS}+(?:[1-5](?:r(?!${LETTERS}))?)?`,
  'giu'
);

/**
 * Split running pinyin such as `ni3hao3` or `nǐhǎo` into syllables.
 * Uses greedy longest-match against valid syllables. An erhua syllable
 * (`huār`, `hua1r`) is accepted only at the end of a word.
 * @param {string} text
 * @returns {string[]|null}
 */
export function segmentPinyin(text) {
  const syllables = [];
  for (const match of text.normalize('NFC').matchAll(PINYIN_WORD)) {
    const parts = segmentWord(match[0]);
    if (!parts) {
      return null;
    }
    syllables.push(...parts);
  }
  return syllables.length ? syllables : null;
}

/** Longest spelling of one syllable: `zhuangr` with a tone digit. */
const MAX_SYLLABLE = 8;

function segmentWord(word) {
  if (!word) {
    return [];
  }
  for (let length = Math.min(MAX_SYLLABLE, word.length); length > 0; length--) {
    let end = length;
    if (/[1-5]/.test(word[end] ?? '')) {
      end++;
    }
    const head = word.slice(0, end);
    const syllable = pinyinSyllableToIpa(head);
    if (!syllable || (syllable.erhua && end < word.length)) {
      continue;
    }
    const rest = segmentWord(word.slice(end));
    if (rest) {
      return [head, ...rest];
    }
  }
  return null;
}
