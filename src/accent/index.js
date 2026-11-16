/**
 * Accents (issue 57): regional and foreign accents as data. An accent is
 * an object, the same as its JSON file:
 *
 *   {"format": "voice-simulator/accent", "version": 1, "code": "en-x-ru",
 *    "name": "English with a Russian accent", "language": "en",
 *    "base": "en-US", "g2p": {}, "rules": [{"map": {"θ": "s"}}],
 *    "phonotactics": {"codas": "any", "maxOnset": 4, "epenthesis": "ə",
 *                     "prothesis": null},
 *    "prosody": {"tunes": "ru", "range": 1, "rate": 1,
 *                "stressLengthening": 1},
 *    "articulation": {}}
 *
 * `base` is the accent applied first, `g2p` holds switches of the
 * language's pronouncer (Russian `okanye` and `fricativeG`, Chinese
 * `erhua` and `lowThird`, English `weakForms`), `rules` and `phonotactics`
 * rewrite the IPA of each word (src/accent/apply.js), `prosody` picks the
 * duration table of a language (`tunes`) and scales the pitch range, the
 * speech rate and the stress lengthening of the head, and `articulation`
 * adds offsets to head values.
 *
 * The strength of an accent (0 to 1, default 1) runs the rules whose `min`
 * it reaches, scales an offset o to o·s and a factor f to 1 + (f − 1)·s; at
 * 0 the accent does nothing at all.
 */

import { ACCENTS, adaptEnglishWord, resolveAccent } from '../g2p/accents.js';
import { ipaUnits } from '../g2p/spelling.js';
import { applyOwnRules } from './apply.js';
import { foreignAccent } from './foreign.js';
import { checkAccent, cloneJson } from './check.js';
import enCA from './definitions/en-CA.js';
import ruNorth from './definitions/ru-x-north.js';
import ruSouth from './definitions/ru-x-south.js';
import hiEast from './definitions/hi-x-east.js';
import zhTW from './definitions/zh-TW.js';
import zhSouth from './definitions/zh-x-south.js';

export { foreignAccent } from './foreign.js';
export { ACCENT_FORMAT, ACCENT_VERSION, MAX_ACCENT_RULES } from './check.js';

/** The regional accents defined in src/accent/definitions/. */
const REGIONAL = Object.freeze(
  Object.fromEntries(
    [enCA, ruNorth, ruSouth, hiEast, zhTW, zhSouth].map((definition) => [
      definition.code,
      definition,
    ])
  )
);

/** English accents that the English pronouncer itself makes. */
const ENGLISH_G2P_ACCENTS = Object.freeze(['en-US', 'en-GB', 'en-AU', 'en-IN']);

const PROSODY_FACTORS = Object.freeze(['range', 'rate', 'stressLengthening']);

const cache = new Map();

/** The ACCENTS entry and language of a code (any case), or null. */
function findEntry(code) {
  const wanted = String(code).toLowerCase();
  for (const [language, list] of Object.entries(ACCENTS)) {
    const entry = list.find((item) => item.code.toLowerCase() === wanted);
    if (entry) {
      return { language, entry };
    }
  }
  return null;
}

/** The definition of a standard accent: no rules of its own. */
function standardDefinition(language, entry) {
  return {
    format: 'voice-simulator/accent',
    version: 1,
    code: entry.code,
    name: entry.name,
    language,
    base: null,
    g2p: {},
    rules: [],
    phonotactics: null,
    prosody: { tunes: language, range: 1, rate: 1, stressLengthening: 1 },
    articulation: {},
  };
}

function buildAccent(language, entry) {
  if (Object.hasOwn(REGIONAL, entry.code)) {
    return cloneJson(REGIONAL[entry.code]);
  }
  if (entry.kind === 'foreign') {
    return foreignAccent(language, entry.code.split('-x-')[1]);
  }
  return standardDefinition(language, entry);
}

/** The shared (not to be changed) definition of a known code, or null. */
function knownAccent(code) {
  const found = typeof code === 'string' ? findEntry(code) : null;
  if (!found) {
    return null;
  }
  if (!cache.has(found.entry.code)) {
    cache.set(
      found.entry.code,
      Object.freeze(buildAccent(found.language, found.entry))
    );
  }
  return cache.get(found.entry.code);
}

/**
 * The definition of an accent code of ACCENTS (`en-x-ru`, `zh-TW`,
 * `en-GB`), or null for an unknown code. A standard accent has no rules of
 * its own; the English ones are made by the English pronouncer.
 * @param {string} code
 * @returns {object|null} a copy that the caller may change.
 */
export function getAccent(code) {
  const definition = knownAccent(code);
  return definition ? cloneJson(definition) : null;
}

/**
 * The definitions an accent is applied with: its bases from the first one
 * applied, then the accent itself.
 */
export function accentChain(definition) {
  const chain = [definition];
  const seen = new Set([definition.code]);
  let base = definition.base;
  while (base) {
    const next = knownAccent(base);
    if (!next || seen.has(next.code)) {
      throw new RangeError(
        `Accent ${definition.code} has the base "${base}", which is ${next ? 'part of a loop' : 'not an accent code'}`
      );
    }
    seen.add(next.code);
    chain.unshift(next);
    base = next.base;
  }
  return chain;
}

function definitionOf(definition) {
  if (typeof definition === 'string') {
    const known = knownAccent(definition);
    if (!known) {
      throw new RangeError(`Unknown accent "${definition}"`);
    }
    return known;
  }
  return definition;
}

/**
 * Apply an accent to the IPA of one word: the rules and phonotactics of
 * its bases, then its own. The g2p switches and the English accents of the
 * English pronouncer need the spelling and come from textToIpa.
 * @param {string} wordIpa
 * @param {object|string} definition an accent definition or code.
 * @param {number} [strength] 0 to 1 (default 1).
 * @returns {string}
 */
export function applyAccent(wordIpa, definition, strength = 1) {
  let ipa = String(wordIpa ?? '');
  for (const item of accentChain(definitionOf(definition))) {
    ipa = applyOwnRules(ipa, item, strength);
  }
  return ipa;
}

const loaded = new WeakMap();

/**
 * Check an accent file and return its definition with the defaults filled
 * in. Throws a TypeError naming the field for a wrong format or version,
 * more than MAX_ACCENT_RULES rules, a unit the IPA parser does not know, an
 * unknown base or a value of the wrong type.
 * @param {object|string} json the object or its JSON text.
 * @returns {object}
 */
export function loadAccent(json) {
  if (json !== null && typeof json === 'object' && loaded.has(json)) {
    return loaded.get(json);
  }
  const definition = checkAccent(json, knownAccent);
  if (json !== null && typeof json === 'object') {
    loaded.set(json, definition);
  }
  return definition;
}

/** Edit distance between two unit lists. */
function unitDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Words of two transcriptions to compare, paired. */
function wordPairs(expected, heard) {
  const left = String(expected ?? '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const right = String(heard ?? '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (left.length === right.length) {
    return left.map((word, index) => [word, right[index]]);
  }
  return [[left.join(' '), right.join(' ')]];
}

/** The English accent of the English pronouncer in an accent's chain. */
function englishAccentOf(chain) {
  for (let index = chain.length - 1; index >= 0; index--) {
    if (ENGLISH_G2P_ACCENTS.includes(chain[index].code)) {
      return chain[index].code;
    }
  }
  return 'en-US';
}

function predictWord(word, chain, language) {
  let ipa = word;
  if (language === 'en') {
    const english = englishAccentOf(chain);
    if (english !== 'en-US') {
      ipa = adaptEnglishWord(ipa, '', english);
    }
  }
  for (const item of chain) {
    ipa = applyOwnRules(ipa, item, 1);
  }
  return ipa;
}

/**
 * Which accents explain how `heard` differs from `expected` (two IPA
 * transcriptions of the same words, standard pronunciation first): each
 * accent of the language but the default is applied to `expected`, and
 * `explained` is how many of the `total` unit edits between the two its
 * prediction removes.
 * @param {string} expectedIpa
 * @param {string} heardIpa
 * @param {string} lang
 * @returns {{code: string, explained: number, total: number}[]} best first.
 */
export function explainAccent(expectedIpa, heardIpa, lang) {
  const list = ACCENTS[lang] ?? [];
  const pairs = wordPairs(expectedIpa, heardIpa).map(([expected, heard]) => [
    expected,
    ipaUnits(heard),
  ]);
  const total = pairs.reduce(
    (sum, [expected, heard]) => sum + unitDistance(ipaUnits(expected), heard),
    0
  );
  return list
    .slice(1)
    .map(({ code }) => {
      const chain = accentChain(knownAccent(code));
      const left = pairs.reduce(
        (sum, [expected, heard]) =>
          sum +
          unitDistance(ipaUnits(predictWord(expected, chain, lang)), heard),
        0
      );
      return { code, explained: Math.max(0, total - left), total };
    })
    .sort((left, right) => right.explained - left.explained);
}

function readStrength(value, field) {
  if (value === undefined || value === null) {
    return 1;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`${field} must be a number from 0 to 1`);
  }
  return Math.min(1, Math.max(0, number));
}

/**
 * The definition and strength an accent option asks for in a language.
 * An unknown code of the language throws a RangeError (unless `lenient`,
 * for the region of a language tag); a code or definition of another
 * language gives the default accent.
 */
function resolveOption(lang, value, { level, lenient }) {
  let option = value;
  let strength = readStrength(level, 'accentLevel');
  let definition = null;
  if (option !== null && typeof option === 'object') {
    if (option.format !== undefined || option.rules !== undefined) {
      definition = loadAccent(option);
    } else {
      if (option.strength !== undefined) {
        strength = readStrength(option.strength, 'accent.strength');
      }
      option = option.code;
    }
  }
  if (definition && definition.language === lang) {
    return { definition, strength };
  }
  let code;
  try {
    code = resolveAccent(lang, definition ? undefined : option);
  } catch (error) {
    if (!lenient) {
      throw error;
    }
    code = ACCENTS[lang][0].code;
  }
  return { definition: knownAccent(code), strength };
}

function mergedProsody(chain, strength) {
  const merged = Object.assign(
    {},
    ...chain.map((definition) => definition.prosody ?? {})
  );
  const prosody = { tunes: strength > 0 ? (merged.tunes ?? null) : null };
  for (const key of PROSODY_FACTORS) {
    const factor = merged[key] ?? 1;
    prosody[key] = 1 + (factor - 1) * strength;
  }
  return prosody;
}

function mergedArticulation(chain, strength) {
  const merged = Object.assign(
    {},
    ...chain.map((definition) => definition.articulation ?? {})
  );
  return Object.fromEntries(
    Object.entries(merged).map(([key, offset]) => [key, offset * strength])
  );
}

/**
 * Everything an accent option means for one language: the accent code,
 * its strength (`level`), the g2p switches, the English accent of the
 * English pronouncer, the definitions whose rules apply (none at strength
 * 0) and the scaled prosody factors and articulation offsets.
 * @param {string} lang
 * @param {string|{code: string, strength?: number}|object} [value]
 *   a code, a code with a strength, or a definition.
 * @param {{level?: number, lenient?: boolean}} [options] `level`: the
 *   strength when the value has none.
 */
export function accentSettings(lang, value, { level, lenient = false } = {}) {
  if (!ACCENTS[lang]) {
    return null;
  }
  const { definition, strength } = resolveOption(lang, value, {
    level,
    lenient,
  });
  const chain = accentChain(definition);
  const active = strength > 0;
  return {
    code: definition.code,
    level: strength,
    language: lang,
    chain: active ? chain : [],
    g2p: active
      ? Object.assign({}, ...chain.map((item) => item.g2p ?? {}))
      : {},
    englishAccent: active ? englishAccentOf(chain) : 'en-US',
    prosody: mergedProsody(chain, strength),
    articulation: mergedArticulation(chain, strength),
  };
}

/**
 * Apply the rules of accent settings (accentSettings) to the IPA of one
 * word of their language.
 * @param {string} wordIpa
 * @param {ReturnType<typeof accentSettings>} settings
 */
export function applyAccentSettings(wordIpa, settings) {
  let ipa = wordIpa;
  for (const definition of settings?.chain ?? []) {
    ipa = applyOwnRules(ipa, definition, settings.level);
  }
  return ipa;
}
