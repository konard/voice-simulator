/**
 * Letter-to-sound alignment helpers for alphabetic words: split an IPA
 * transcription into phone units and pair each vowel nucleus with the
 * vowel letters that spell it. Accent rules use the pairs to tell LOT
 * (`o`) from PALM (`a`), and the timeline uses them to find the letters
 * of each syllable.
 */

/** Vowel phones, diphthongs first so they win over their parts. */
const VOWEL_UNIT =
  /^(?:eɪ|aɪ|oʊ|aʊ|ɔɪ|əʊ|əʉ|æɪ|ɑe|æɔ|ɪə|ɛə|ʊə|[aeiouyæɑɒɔəɛɪʊʌɝɚɜɐʉɨɯøœɤ])[ːˑ]?̃?/u;
const AFFRICATE_UNIT = /^.͡./u;
const COMBINING = /^[̀-ͯʰ-˿ː]/u;

/** IPA phone units of one word: stress marks, vowels, consonants. */
export function ipaUnits(ipa) {
  const units = [];
  let rest = ipa;
  while (rest) {
    const match = rest.match(VOWEL_UNIT) ??
      rest.match(AFFRICATE_UNIT) ?? [[...rest][0]];
    let unit = match[0];
    rest = rest.slice(unit.length);
    while (rest && COMBINING.test(rest) && !/^[ˈˌ]/u.test(rest)) {
      const mark = [...rest][0];
      unit += mark;
      rest = rest.slice(mark.length);
    }
    units.push(unit);
  }
  return units;
}

/** Whether an IPA unit is a vowel nucleus. */
export function isVowelUnit(unit) {
  return VOWEL_UNIT.test(unit) || unit.includes('̩');
}

/** Drop a consonantal initial `y` and the `u` of `qu` from a group. */
function vowelGroup(lower, start, letters) {
  let index = start;
  let rest = letters;
  if (index === 0 && rest[0] === 'y') {
    index++;
    rest = rest.slice(1);
  }
  if (lower[index - 1] === 'q' && rest[0] === 'u') {
    index++;
    rest = rest.slice(1);
  }
  return rest
    ? { letters: rest, start: index, end: index + rest.length }
    : null;
}

/**
 * Vowel letter groups of a spelling with their offsets. `y` is a vowel
 * except before a vowel at the start, `u` after `q` is a consonant and a
 * silent final `e` is dropped.
 * @param {string} spelling
 * @returns {{letters: string, start: number, end: number}[]}
 */
export function vowelGroups(spelling) {
  const lower = spelling.toLowerCase();
  const groups = [];
  const pattern = /[aeiouy]+/g;
  for (const match of lower.matchAll(pattern)) {
    const group = vowelGroup(lower, match.index, match[0]);
    if (group) {
      groups.push(group);
    }
  }
  const last = groups.at(-1);
  const silentE =
    last &&
    groups.length > 1 &&
    last.letters === 'e' &&
    (last.end === lower.length ||
      (last.end === lower.length - 1 && /[sd]$/.test(lower))) &&
    !/[^aeiou]le$/.test(lower);
  return silentE ? groups.slice(0, -1) : groups;
}

/**
 * Pair each vowel nucleus of `units` with a vowel letter group, or
 * return null when the counts disagree.
 * @param {string} spelling
 * @param {string[]} units
 * @returns {(object|null)[]|null} One group per unit (null for consonants).
 */
export function alignVowels(spelling, units) {
  const groups = vowelGroups(spelling);
  const nuclei = units.filter(isVowelUnit).length;
  if (!nuclei || groups.length !== nuclei) {
    return null;
  }
  let next = 0;
  return units.map((unit) => (isVowelUnit(unit) ? groups[next++] : null));
}
