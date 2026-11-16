/**
 * The checks of an accent file (loadAccent of src/accent/index.js). Every
 * wrong field throws a TypeError that names it (`rules[3].map`).
 */

import { ACCENTS } from '../g2p/accents.js';
import { parseIpa } from '../ipa/parse.js';
import { getHeadParameter } from '../head-config.js';

export const ACCENT_FORMAT = 'voice-simulator/accent';
export const ACCENT_VERSION = 1;
export const MAX_ACCENT_RULES = 500;

/** A deep copy of a JSON value (an accent definition). */
export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const TOP_KEYS = new Set([
  '$schema',
  'format',
  'version',
  'code',
  'name',
  'description',
  'language',
  'base',
  'g2p',
  'rules',
  'phonotactics',
  'prosody',
  'articulation',
]);
const RULE_KEYS = new Set([
  'map',
  'match',
  'add',
  'remove',
  'before',
  'after',
  'stress',
  'min',
  'note',
]);
const MATCH_KEYS = new Set([
  'kind',
  'place',
  'manner',
  'voiced',
  'height',
  'backness',
  'rounded',
]);
const CLASSES = new Set(['#', 'V', 'C', 'voiceless', 'front']);
const PHONOTACTIC_KEYS = new Set([
  'codas',
  'maxOnset',
  'epenthesis',
  'prothesis',
]);
const PROSODY_FACTORS = ['range', 'rate', 'stressLengthening'];
const G2P_SWITCHES = Object.freeze({
  en: ['weakForms'],
  ru: ['okanye', 'fricativeG'],
  hi: [],
  zh: ['erhua', 'lowThird'],
});

function fail(field, message) {
  throw new TypeError(`Accent field ${field} ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(field ? `${field}.${key}` : key, 'is not a known field');
    }
  }
}

/** Throw unless `value` is IPA that parseIpa knows (an empty string is not). */
function checkUnits(value, field, { prefix = '' } = {}) {
  if (typeof value !== 'string' || value === '') {
    fail(field, 'must be a non-empty IPA string');
  }
  const { unknown } = parseIpa(prefix + value);
  if (unknown.length > 0) {
    fail(
      field,
      `has symbols the IPA parser does not know: ${unknown.join(' ')}`
    );
  }
}

function checkContext(value, field) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || value === '') {
    fail(field, `must be a unit or one of ${[...CLASSES].join(' ')}`);
  }
  if (!CLASSES.has(value)) {
    checkUnits(value, field);
  }
}

function checkMatch(match, field) {
  if (!isObject(match) || Object.keys(match).length === 0) {
    fail(field, 'must be an object of phoneme fields');
  }
  checkKeys(match, MATCH_KEYS, field);
  for (const [key, value] of Object.entries(match)) {
    const allowed = ['string', 'number', 'boolean'].includes(typeof value);
    if (!allowed && !Array.isArray(value)) {
      fail(`${field}.${key}`, 'must be a value or a list of values');
    }
  }
}

function checkMap(map, field) {
  if (!isObject(map)) {
    fail(field, 'must be an object of IPA units');
  }
  for (const [from, to] of Object.entries(map)) {
    checkUnits(from, `${field} key "${from}"`);
    checkUnits(to, `${field}["${from}"]`);
  }
}

function checkMarks(rule, field) {
  for (const key of ['add', 'remove']) {
    if (rule[key] !== undefined) {
      if (typeof rule[key] !== 'string' || rule[key] === '') {
        fail(`${field}.${key}`, 'must be a diacritic');
      }
      checkUnits(rule[key], `${field}.${key}`, { prefix: 'a' });
    }
  }
}

function checkRule(rule, field) {
  if (!isObject(rule)) {
    fail(field, 'must be an object');
  }
  checkKeys(rule, RULE_KEYS, field);
  if ((rule.map === undefined) === (rule.match === undefined)) {
    fail(field, 'must have one of map and match');
  }
  if (rule.map !== undefined) {
    checkMap(rule.map, `${field}.map`);
  } else {
    checkMatch(rule.match, `${field}.match`);
    if (rule.add === undefined && rule.remove === undefined) {
      fail(field, 'with match must have add or remove');
    }
  }
  checkMarks(rule, field);
  checkContext(rule.before, `${field}.before`);
  checkContext(rule.after, `${field}.after`);
  if (
    rule.stress !== undefined &&
    !['stressed', 'unstressed'].includes(rule.stress)
  ) {
    fail(`${field}.stress`, 'must be "stressed" or "unstressed"');
  }
  if (
    rule.min !== undefined &&
    !(typeof rule.min === 'number' && rule.min >= 0 && rule.min <= 1)
  ) {
    fail(`${field}.min`, 'must be a number from 0 to 1');
  }
  if (rule.note !== undefined && typeof rule.note !== 'string') {
    fail(`${field}.note`, 'must be a string');
  }
}

function checkRules(rules) {
  if (rules === undefined) {
    return [];
  }
  if (!Array.isArray(rules)) {
    fail('rules', 'must be an array');
  }
  if (rules.length > MAX_ACCENT_RULES) {
    fail('rules', `has ${rules.length} rules (at most ${MAX_ACCENT_RULES})`);
  }
  rules.forEach((rule, index) => checkRule(rule, `rules[${index}]`));
  return rules;
}

function checkPhonotactics(phonotactics) {
  if (phonotactics === undefined || phonotactics === null) {
    return null;
  }
  if (!isObject(phonotactics)) {
    fail('phonotactics', 'must be an object');
  }
  checkKeys(phonotactics, PHONOTACTIC_KEYS, 'phonotactics');
  const { codas, maxOnset, epenthesis, prothesis } = phonotactics;
  if (codas !== undefined && codas !== 'any') {
    if (!Array.isArray(codas)) {
      fail('phonotactics.codas', 'must be "any" or a list of units');
    }
    codas.forEach((unit, index) =>
      checkUnits(unit, `phonotactics.codas[${index}]`)
    );
  }
  if (
    maxOnset !== undefined &&
    !(Number.isInteger(maxOnset) && maxOnset >= 0)
  ) {
    fail('phonotactics.maxOnset', 'must be a whole number from 0');
  }
  for (const [key, value] of [
    ['epenthesis', epenthesis],
    ['prothesis', prothesis],
  ]) {
    if (value !== undefined && value !== null) {
      checkUnits(value, `phonotactics.${key}`);
    }
  }
  return {
    codas: 'any',
    maxOnset: 4,
    epenthesis: 'ə',
    prothesis: null,
    ...phonotactics,
  };
}

function checkProsody(prosody, language) {
  const result = { tunes: language, range: 1, rate: 1, stressLengthening: 1 };
  if (prosody === undefined || prosody === null) {
    return result;
  }
  if (!isObject(prosody)) {
    fail('prosody', 'must be an object');
  }
  checkKeys(prosody, new Set(['tunes', ...PROSODY_FACTORS]), 'prosody');
  if (prosody.tunes !== undefined && !Object.hasOwn(ACCENTS, prosody.tunes)) {
    fail('prosody.tunes', `must be one of ${Object.keys(ACCENTS).join(', ')}`);
  }
  for (const key of PROSODY_FACTORS) {
    const value = prosody[key];
    if (
      value !== undefined &&
      !(typeof value === 'number' && value > 0 && Number.isFinite(value))
    ) {
      fail(`prosody.${key}`, 'must be a positive number');
    }
  }
  return { ...result, ...prosody };
}

function checkArticulation(articulation) {
  if (articulation === undefined || articulation === null) {
    return {};
  }
  if (!isObject(articulation)) {
    fail('articulation', 'must be an object of head offsets');
  }
  for (const [key, value] of Object.entries(articulation)) {
    if (!getHeadParameter(key)) {
      fail(`articulation.${key}`, 'is not a head parameter');
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`articulation.${key}`, 'must be a number');
    }
  }
  return { ...articulation };
}

function checkG2p(g2p, language) {
  if (g2p === undefined || g2p === null) {
    return {};
  }
  if (!isObject(g2p)) {
    fail('g2p', 'must be an object of switches');
  }
  checkKeys(g2p, new Set(G2P_SWITCHES[language]), 'g2p');
  for (const [key, value] of Object.entries(g2p)) {
    if (typeof value !== 'boolean') {
      fail(`g2p.${key}`, 'must be true or false');
    }
  }
  return { ...g2p };
}

function parseJson(json) {
  if (typeof json !== 'string') {
    return json;
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new TypeError(`Accent file is not JSON: ${error.message}`, {
      cause: error,
    });
  }
}

function checkHeader(data) {
  if (data.format !== ACCENT_FORMAT) {
    fail('format', `must be "${ACCENT_FORMAT}"`);
  }
  if (data.version !== ACCENT_VERSION) {
    fail('version', `must be ${ACCENT_VERSION}`);
  }
  if (
    typeof data.code !== 'string' ||
    !/^[a-z]{2,3}(-[\w-]+)?$/iu.test(data.code)
  ) {
    fail('code', 'must be a language tag such as "en-x-mine"');
  }
  if (data.name !== undefined && typeof data.name !== 'string') {
    fail('name', 'must be a string');
  }
  if (!Object.hasOwn(ACCENTS, data.language)) {
    fail('language', `must be one of ${Object.keys(ACCENTS).join(', ')}`);
  }
}

function checkBase(data, knownAccent) {
  if (data.base === undefined || data.base === null) {
    return ACCENTS[data.language][0].code;
  }
  const base = typeof data.base === 'string' ? knownAccent(data.base) : null;
  if (!base || base.language !== data.language) {
    fail('base', `must be an accent code of ${data.language}`);
  }
  return base.code;
}

/**
 * Check an accent file and return a definition with the defaults filled
 * in.
 * @param {object|string} json
 * @param {(code: string) => object|null} knownAccent the definitions of
 *   the built-in codes.
 */
export function checkAccent(json, knownAccent) {
  const data = parseJson(json);
  if (!isObject(data)) {
    throw new TypeError('Accent file must be a JSON object');
  }
  checkKeys(data, TOP_KEYS, '');
  checkHeader(data);
  return {
    format: ACCENT_FORMAT,
    version: ACCENT_VERSION,
    code: data.code,
    name: data.name ?? data.code,
    language: data.language,
    base: checkBase(data, knownAccent),
    g2p: checkG2p(data.g2p, data.language),
    rules: cloneJson(checkRules(data.rules)),
    phonotactics: checkPhonotactics(data.phonotactics),
    prosody: checkProsody(data.prosody, data.language),
    articulation: checkArticulation(data.articulation),
  };
}
