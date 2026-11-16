/**
 * Foreign accents: a language spoken with the sounds of a first language
 * (`en-x-ru` is English with a Russian accent). The definition of
 * `<target>-x-<first>` is built from the profile of the first language
 * (src/accent/profiles/), in this order:
 *
 * 1. The profile's substitutions (`θ → s`), for the units of the target.
 * 2. Every other unit of the target that the first language lacks becomes
 *    its nearest unit there: the same kind (vowel or consonant), the fewest
 *    differing fields (manner, place, voicing, rounding; places, heights
 *    and backness count by how far apart they are, see `distance`), then
 *    the same aspiration; the first unit of the inventory wins a tie. A
 *    length mark and the syllabic mark stay, a nasal mark goes, a diphthong
 *    is mapped vowel by vowel, and a palatalised consonant loses its
 *    palatalisation (or becomes consonant + `j` with `splitPalatalized`).
 * 3. The profile's processes, phonotactics and prosody.
 */

import { getPhoneme } from '../ipa/inventory.js';
import { ipaUnits } from '../g2p/spelling.js';
import { ACCENTS } from '../g2p/accents.js';
import { splitTones, unitFeatures } from './apply.js';
import { cloneJson } from './check.js';
import ru from './profiles/ru.js';
import hi from './profiles/hi.js';
import zh from './profiles/zh.js';
import en from './profiles/en.js';

/** The profiles of the first languages, by language code. */
export const PROFILES = Object.freeze({ en, ru, hi, zh });

const SYLLABIC = '̩';
const NASAL = '̃';
const ASPIRATION = /[ʰʱ]/u;

/**
 * A unit for inventory membership: NFD, no tones, no length mark and no
 * unaspirated mark (an unmarked plosive is unaspirated).
 */
function memberKey(unit) {
  return splitTones(unit)[0].normalize('NFD').replace(/[ːˑ˭]/gu, '');
}

function vowelCount(unit) {
  return [...unit.normalize('NFD')].filter(
    (char) => getPhoneme(char)?.kind === 'vowel'
  ).length;
}

/** True when the unit is said as a vowel (a syllabic consonant too). */
function isNucleus(unit) {
  return vowelCount(unit) > 0 || unit.includes(SYLLABIC);
}

/** Places of articulation from the lips back, for how far apart two are. */
const PLACES = Object.freeze({
  bilabial: 0,
  'labial-velar': 0.5,
  labiodental: 1,
  dental: 2,
  alveolar: 3,
  postalveolar: 4,
  retroflex: 4.5,
  alveolopalatal: 4.5,
  'labial-palatal': 5.5,
  palatal: 6,
  velar: 7,
  uvular: 8,
  pharyngeal: 9,
  glottal: 10,
});

/** Manners that are close to each other (a difference counts half). */
const MANNER_FAMILIES = Object.freeze({
  plosive: 'stop',
  affricate: 'stop',
  fricative: 'fricative',
  'lateral-fricative': 'fricative',
  trill: 'liquid',
  tap: 'liquid',
  approximant: 'liquid',
  'lateral-approximant': 'liquid',
  nasal: 'nasal',
});

function consonantDistance(left, right) {
  let value = 0;
  if (left.manner !== right.manner) {
    const near =
      MANNER_FAMILIES[left.manner] === MANNER_FAMILIES[right.manner] ||
      [left.manner, right.manner].every((manner) =>
        ['affricate', 'fricative'].includes(manner)
      );
    value += near ? 1 : 2;
  }
  if (left.place !== right.place) {
    const apart = Math.abs(
      (PLACES[left.place] ?? 5) - (PLACES[right.place] ?? 5)
    );
    value += Math.min(1, Math.max(0.25, apart / 6));
  }
  if (left.voiced !== right.voiced) {
    value += 1;
  }
  return value;
}

function vowelDistance(left, right) {
  return (
    (left.rounded === right.rounded ? 0 : 0.5) +
    2 * Math.abs(left.height - right.height) +
    Math.abs(left.backness - right.backness)
  );
}

/**
 * How far apart two units are; Infinity for different kinds. Consonants
 * count a different manner (half for a near one: plosive and affricate,
 * fricative and affricate, two liquids), the distance between their places
 * and voicing; vowels count rounding, height and backness. A different
 * aspiration only breaks a tie.
 */
function distance(target, candidate) {
  const left = unitFeatures(target.normalize('NFD'));
  const right = unitFeatures(candidate.normalize('NFD'));
  if (!left || !right || left.kind !== right.kind) {
    return Infinity;
  }
  if (isNucleus(target) !== isNucleus(candidate)) {
    return Infinity;
  }
  const value =
    left.kind === 'vowel'
      ? vowelDistance(left, right)
      : consonantDistance(left, right);
  const aspiration =
    ASPIRATION.test(target) === ASPIRATION.test(candidate) ? 0 : 0.1;
  return value + aspiration;
}

/** The nearest unit of `inventory` to `unit` (one vowel or consonant). */
function nearestUnit(unit, inventory) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of inventory) {
    if (vowelCount(candidate) > 1) {
      continue;
    }
    const value = distance(unit, candidate);
    if (value < bestDistance) {
      best = candidate;
      bestDistance = value;
    }
  }
  return best;
}

/** The target's own units and the context of a profile substitution. */
function targetInfo(target) {
  const inventory = PROFILES[target].inventory;
  const keys = new Set(inventory.map(memberKey));
  const contrastsAspiration = inventory.some(
    (unit) => /ʰ/u.test(unit) && keys.has(memberKey(unit.replace('ʰ', '')))
  );
  return { language: target, inventory, contrastsAspiration };
}

/** The nearest unit of the first language, keeping length and syllabic marks. */
function nearestReplacement(unit, profile) {
  const key = memberKey(unit);
  const nearest = nearestUnit(key, profile.inventory);
  if (nearest === null) {
    return unit;
  }
  let result = memberKey(nearest);
  if (key.includes(SYLLABIC) && !isNucleus(result)) {
    result += SYLLABIC;
  }
  if (/[ːˑ]/u.test(unit)) {
    result += 'ː';
  }
  return result;
}

/** The substitution the profile gives for a unit, or undefined. */
function substitution(unit, context) {
  const { profile, substitutions, info } = context;
  if (Object.hasOwn(substitutions, unit)) {
    return substitutions[unit];
  }
  const short = unit.replace(/[ːˑ]/gu, '');
  if (short !== unit && Object.hasOwn(substitutions, short)) {
    const value = substitutions[short];
    // A long vowel keeps its length when it stays one vowel.
    return vowelCount(value) === 1 ? `${value}ː` : value;
  }
  return profile.substitute?.(unit, info);
}

/**
 * The first language's version of one unit of the target: its
 * substitution, itself when the first language has it, the plain unit for
 * a palatalised one (or the plain one + `j` with `splitPalatalized`), a
 * diphthong vowel by vowel, or the nearest unit. A substitution that gives
 * units the first language lacks is resolved again.
 */
function resolveUnit(unit, context, depth = 0) {
  const { profile, members } = context;
  const substituted = depth < 3 ? substitution(unit, context) : undefined;
  if (substituted !== undefined) {
    return ipaUnits(substituted)
      .map((part) =>
        part === unit ? part : resolveUnit(part, context, depth + 1)
      )
      .join('');
  }
  const key = memberKey(unit);
  if (members.has(key)) {
    return unit;
  }
  if (key.includes(NASAL)) {
    return resolveUnit(
      unit.normalize('NFD').replace(NASAL, ''),
      context,
      depth + 1
    );
  }
  if (key.includes('ʲ')) {
    const plain = resolveUnit(unit.replace('ʲ', ''), context, depth + 1);
    return profile.splitPalatalized ? `${plain}j` : plain;
  }
  if (vowelCount(key) > 1) {
    return [...key]
      .map((char) =>
        getPhoneme(char)?.kind === 'vowel'
          ? resolveUnit(char, context, depth + 1)
          : char
      )
      .join('');
  }
  return nearestReplacement(unit, profile);
}

/** The unit map of a target spoken with the sounds of a first language. */
function unitMap(target, profile) {
  const special = profile.targets?.[target] ?? {};
  const context = {
    profile,
    info: targetInfo(target),
    substitutions: { ...profile.substitutions, ...special.substitutions },
    members: new Set(profile.inventory.map(memberKey)),
  };
  const map = {};
  for (const unit of context.info.inventory) {
    const value = resolveUnit(unit, context);
    if (value !== unit) {
      map[unit] = value;
    }
  }
  return map;
}

/**
 * The definition of a foreign accent: `target` spoken with the sounds of
 * `first` (`foreignAccent('en', 'ru')` is `en-x-ru`).
 * @param {'en'|'ru'|'hi'|'zh'} target
 * @param {'en'|'ru'|'hi'|'zh'} first
 */
export function foreignAccent(target, first) {
  const profile = PROFILES[first];
  if (!PROFILES[target] || !profile || target === first) {
    throw new RangeError(
      `No foreign accent of ${target} with ${first} sounds (use two of ${Object.keys(PROFILES).join(', ')})`
    );
  }
  const special = profile.targets?.[target] ?? {};
  return {
    format: 'voice-simulator/accent',
    version: 1,
    code: `${target}-x-${first}`,
    name: `${PROFILES[target].name} with ${/^[AEIOU]/u.test(profile.name) ? 'an' : 'a'} ${profile.name} accent`,
    language: target,
    base: special.base ?? ACCENTS[target][0].code,
    // A learner says every word in its full (strong) form.
    g2p: target === 'en' ? { weakForms: false } : {},
    rules: [
      { map: unitMap(target, profile) },
      ...profile.processes.map((rule) => cloneJson(rule)),
    ],
    phonotactics: { ...profile.phonotactics },
    prosody: { range: 1, rate: 1, stressLengthening: 1, ...profile.prosody },
    articulation: {},
  };
}
