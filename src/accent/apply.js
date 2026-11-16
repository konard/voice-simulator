/**
 * The rule engine of accents (issue 57). An accent rewrites the IPA of
 * each word after the language's own rules made it:
 *
 * - A rule works on the units of one word (`ipaUnits()` of
 *   src/g2p/spelling.js: a sound with its diacritics, a diphthong, an
 *   affricate or a stress mark), in the listed order, once, left to right.
 * - `map` replaces units: `{"θ": "s"}`. A key may span units (`"iŋ"`);
 *   tone letters of the matched units stay on the replacement.
 * - `match` selects units by the `getPhoneme()` fields `kind`, `place`,
 *   `manner`, `voiced`, `height`, `backness` and `rounded` (an affricate
 *   has the manner `affricate` and the place of its fricative); `add`
 *   writes a diacritic after it, `remove` deletes one.
 * - `before` and `after` ask for the unit that follows or precedes (stress
 *   marks are skipped): a unit or a class, `#` the word edge, `V` a vowel,
 *   `C` a consonant, `voiceless` a voiceless obstruent, `front` one of
 *   `i e ɛ j`.
 * - `stress` is `stressed` or `unstressed`: the stress of the syllable of
 *   a vowel, and for a consonant the stress of the next vowel (or of the
 *   last one at the end of the word). A word without stress marks counts as
 *   stressed when it has one vowel and is skipped by these rules otherwise
 *   (Hindi and Chinese write no stress).
 * - `min` (default 0): the rule runs when the strength of the accent is at
 *   least `min`.
 *
 * Phonotactics repair the word afterwards: a final consonant outside
 * `codas` gets the `epenthesis` vowel after it, a word-initial cluster of
 * more than `maxOnset` consonants (`j` and `w` not counted) gets it between
 * its consonants, and `prothesis` goes before a word-initial `s` + plosive,
 * in front of the stress mark.
 */

import { getPhoneme } from '../ipa/inventory.js';
import { ipaUnits, isVowelUnit } from '../g2p/spelling.js';

const STRESS_MARK = /^[ˈˌ]$/u;
const TONE_LETTERS = new Set(['˥', '˦', '˧', '˨', '˩']);
/** Marks that change the voicing of the sound they follow. */
const VOICELESS_MARKS = /[̥̊]/u;
const VOICED_MARK = /̬/u;
/** Aspiration marks: a unit has at most one of them. */
const ASPIRATION_MARKS = ['ʰ', '˭', 'ʱ'];
const FRONT = new Set(['i', 'e', 'ɛ', 'j']);
const GLIDES = new Set(['j', 'w']);
const OBSTRUENT_MANNERS = new Set([
  'plosive',
  'fricative',
  'affricate',
  'lateral-fricative',
]);

/** A unit without its tone letters, and the tone letters. */
export function splitTones(unit) {
  // A backward scan, linear in the length (a /[˥-˩]+$/ search is not).
  let end = unit.length;
  while (end > 0 && TONE_LETTERS.has(unit[end - 1])) {
    end--;
  }
  return [unit.slice(0, end), unit.slice(end)];
}

/** The base symbols of a unit: its letters without diacritics and ties. */
function baseSymbols(unit) {
  return [...unit.normalize('NFD')].filter((char) => getPhoneme(char));
}

/**
 * The phonetic fields of a unit: those of `getPhoneme()` for its first
 * symbol; an affricate (`t͡ʃ`) has the manner `affricate` and the place of
 * its fricative, and a voicing diacritic changes `voiced`.
 * @param {string} unit
 * @returns {object|null}
 */
export function unitFeatures(unit) {
  const symbols = baseSymbols(splitTones(unit)[0]);
  const first = getPhoneme(symbols[0]);
  if (!first) {
    return null;
  }
  const features = { ...first };
  if (unit.includes('͡') && symbols.length > 1) {
    const fricative = getPhoneme(symbols[1]);
    Object.assign(features, {
      manner: 'affricate',
      place: fricative.place,
      voiced: fricative.voiced,
    });
  }
  if (VOICELESS_MARKS.test(unit)) {
    features.voiced = false;
  } else if (VOICED_MARK.test(unit)) {
    features.voiced = true;
  }
  return features;
}

/** True for a vowel unit (a syllabic consonant counts as a vowel). */
function isVowel(unit) {
  return isVowelUnit(splitTones(unit)[0]);
}

/** True for a consonant unit. */
function isConsonant(unit) {
  return !isVowel(unit) && unitFeatures(unit)?.kind === 'consonant';
}

/** The unit for comparisons: no tone letters and no length mark. */
function plainUnit(unit) {
  return splitTones(unit)[0].normalize('NFD').replace(/[ːˑ]/gu, '');
}

/** Does the neighbour `unit` (undefined at the word edge) fit `context`? */
function fitsContext(unit, context) {
  if (context === '#') {
    return unit === undefined;
  }
  if (unit === undefined) {
    return false;
  }
  switch (context) {
    case 'V':
      return isVowel(unit);
    case 'C':
      return isConsonant(unit);
    case 'voiceless': {
      const features = unitFeatures(unit);
      return (
        isConsonant(unit) &&
        !features.voiced &&
        OBSTRUENT_MANNERS.has(features.manner)
      );
    }
    case 'front':
      return FRONT.has(plainUnit(unit));
    default:
      return plainUnit(unit) === plainUnit(context);
  }
}

/** The index of the next (step 1) or previous (step -1) sound, skipping stress marks. */
function neighbour(units, index, step) {
  let at = index + step;
  while (at >= 0 && at < units.length && STRESS_MARK.test(units[at])) {
    at += step;
  }
  return units[at];
}

/**
 * The stress of every unit of a word: true, false, or null where it is not
 * known (a word of several vowels without stress marks).
 */
function stressOf(units) {
  const vowels = units.filter(isVowel).length;
  const marked = units.some((unit) => STRESS_MARK.test(unit));
  if (!marked) {
    return units.map(() => (vowels === 1 ? true : null));
  }
  const nuclei = [];
  let pending = false;
  units.forEach((unit, index) => {
    if (STRESS_MARK.test(unit)) {
      pending = true;
    } else if (isVowel(unit)) {
      nuclei[index] = pending;
      pending = false;
    }
  });
  let last = false;
  const result = units.map((unit, index) => {
    if (nuclei[index] !== undefined) {
      last = nuclei[index];
    }
    return last;
  });
  let next = null;
  for (let index = units.length - 1; index >= 0; index--) {
    if (nuclei[index] !== undefined) {
      next = nuclei[index];
    } else if (next !== null) {
      result[index] = next;
    }
  }
  return result;
}

/** Does the unit at `index` satisfy the conditions of `rule`? */
function fitsRule(units, index, rule, stress, length = 1) {
  if (
    rule.before !== undefined &&
    !fitsContext(neighbour(units, index + length - 1, 1), rule.before)
  ) {
    return false;
  }
  if (
    rule.after !== undefined &&
    !fitsContext(neighbour(units, index, -1), rule.after)
  ) {
    return false;
  }
  if (rule.stress !== undefined) {
    const wanted = rule.stress === 'stressed';
    if (stress[index] === null || stress[index] !== wanted) {
      return false;
    }
  }
  return true;
}

/** Does the unit fit the `match` fields of a rule? */
function fitsMatch(unit, match) {
  if (STRESS_MARK.test(unit)) {
    return false;
  }
  const features = unitFeatures(unit);
  if (!features) {
    return false;
  }
  const kind = isVowel(unit) ? 'vowel' : features.kind;
  return Object.entries(match).every(([field, value]) =>
    field === 'kind' ? kind === value : features[field] === value
  );
}

/** The keys of a map rule as unit lists, longest first. */
function mapKeys(map) {
  return Object.keys(map)
    .map((key) => ({ key, units: ipaUnits(key) }))
    .sort((left, right) => right.units.length - left.units.length);
}

/** The length of the key that matches at `index` (tones ignored), or 0. */
function keyLength(units, index, keyUnits) {
  if (index + keyUnits.length > units.length) {
    return 0;
  }
  return keyUnits.every(
    (unit, offset) => splitTones(units[index + offset])[0] === unit
  )
    ? keyUnits.length
    : 0;
}

/** Replace the matched units by `value`, keeping their tone letters. */
function replacement(matched, value) {
  const tones = matched.map((unit) => splitTones(unit)[1]).join('');
  const units = ipaUnits(value);
  if (tones && units.length > 0) {
    units[units.length - 1] += tones;
  } else if (tones) {
    units.push(tones);
  }
  return units;
}

function applyMap(units, rule) {
  const keys = mapKeys(rule.map);
  const stress = stressOf(units);
  const result = [];
  let index = 0;
  while (index < units.length) {
    const found = keys.find(
      ({ units: keyUnits }) =>
        keyLength(units, index, keyUnits) > 0 &&
        fitsRule(units, index, rule, stress, keyUnits.length)
    );
    if (found) {
      const matched = units.slice(index, index + found.units.length);
      result.push(...replacement(matched, rule.map[found.key]));
      index += found.units.length;
    } else {
      result.push(units[index]);
      index++;
    }
  }
  return result;
}

/** Write `mark` after the sound of `unit` (before its tone letters). */
function addMark(unit, mark) {
  const [sound, tones] = splitTones(unit);
  if (sound.includes(mark)) {
    return unit;
  }
  if (
    ASPIRATION_MARKS.includes(mark) &&
    ASPIRATION_MARKS.some((other) => sound.includes(other))
  ) {
    return unit;
  }
  return `${sound}${mark}${tones}`;
}

function removeMark(unit, mark) {
  return unit.replaceAll(mark, '');
}

function applyMatch(units, rule) {
  const stress = stressOf(units);
  return units.map((unit, index) => {
    if (!fitsMatch(unit, rule.match) || !fitsRule(units, index, rule, stress)) {
      return unit;
    }
    let result = unit;
    if (rule.remove) {
      result = removeMark(result, rule.remove);
    }
    if (rule.add) {
      result = addMark(result, rule.add);
    }
    return result;
  });
}

/**
 * Apply one rule to the units of a word.
 * @param {string[]} units
 * @param {object} rule
 */
export function applyRule(units, rule) {
  if (rule.map) {
    return applyMap(units, rule);
  }
  if (rule.match) {
    return applyMatch(units, rule);
  }
  return units;
}

/** True for a consonant unit listed in `codas` (or any with `"any"`). */
function allowedCoda(unit, codas) {
  if (codas === undefined || codas === null || codas === 'any') {
    return true;
  }
  const plain = splitTones(unit)[0];
  return codas.includes(plain) || codas.includes(plainUnit(unit));
}

function addProthesis(units, prothesis) {
  if (!prothesis) {
    return units;
  }
  const first = units.findIndex((unit) => !STRESS_MARK.test(unit));
  const second = neighbour(units, first, 1);
  const features = second === undefined ? null : unitFeatures(second);
  if (
    units[first] === 's' &&
    features?.kind === 'consonant' &&
    features.manner === 'plosive' &&
    !isVowel(second)
  ) {
    return [prothesis, ...units];
  }
  return units;
}

/** True for a consonant that counts in an onset (`j` and `w` do not). */
function countsInOnset(unit) {
  return isConsonant(unit) && !GLIDES.has(plainUnit(unit));
}

/**
 * Break up a word-initial cluster of more than `maxOnset` consonants: the
 * vowel goes between every two of them (`ˈstɹit` → `sətəˈɹit`), and the
 * stress mark moves to the last consonant of the onset (with the glides
 * after it).
 */
function splitOnset(units, maxOnset, vowel) {
  if (!vowel || typeof maxOnset !== 'number') {
    return units;
  }
  let end = units.findIndex(isVowel);
  if (end < 0) {
    end = units.length;
  }
  const onset = units.slice(0, end);
  if (onset.filter(countsInOnset).length <= maxOnset) {
    return units;
  }
  const mark = onset.find((unit) => STRESS_MARK.test(unit));
  const sounds = onset.filter((unit) => !STRESS_MARK.test(unit));
  const result = [];
  sounds.forEach((unit, index) => {
    if (index > 0 && countsInOnset(unit)) {
      result.push(vowel);
    }
    result.push(unit);
  });
  if (mark && end < units.length) {
    let at = result.length;
    while (at > 0 && !countsInOnset(result[at - 1])) {
      at--;
    }
    result.splice(Math.max(0, at - 1), 0, mark);
  }
  return [...result, ...units.slice(end)];
}

/**
 * Apply the phonotactics of an accent to the units of a word.
 * @param {string[]} units
 * @param {{codas?: 'any'|string[], maxOnset?: number, epenthesis?: string|null, prothesis?: string|null}} [phonotactics]
 */
export function applyPhonotactics(units, phonotactics) {
  if (!phonotactics) {
    return units;
  }
  const { codas, maxOnset, epenthesis = null, prothesis = null } = phonotactics;
  let result = splitOnset(addProthesis(units, prothesis), maxOnset, epenthesis);
  const last = result.at(-1);
  if (
    epenthesis &&
    last !== undefined &&
    isConsonant(last) &&
    !allowedCoda(last, codas)
  ) {
    result = [...result, epenthesis];
  }
  return result;
}

/**
 * Apply the rules and phonotactics of one accent definition (without its
 * base) to the IPA of one word; parts separated by spaces (the syllables
 * of a Chinese word, a joined clitic) are words of their own.
 * @param {string} wordIpa
 * @param {{rules?: object[], phonotactics?: object}} definition
 * @param {number} [strength] 0 to 1 (default 1); 0 leaves the word alone.
 */
export function applyOwnRules(wordIpa, definition, strength = 1) {
  if (!wordIpa || !(strength > 0)) {
    return wordIpa;
  }
  return String(wordIpa)
    .split(' ')
    .map((part) => {
      if (!part) {
        return part;
      }
      let units = ipaUnits(part);
      for (const rule of definition.rules ?? []) {
        if (strength >= (rule.min ?? 0)) {
          units = applyRule(units, rule);
        }
      }
      return applyPhonotactics(units, definition.phonotactics).join('');
    })
    .join(' ');
}
