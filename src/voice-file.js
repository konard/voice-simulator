/**
 * Voice files (issue 41): a voice is a preset plus the head values that
 * differ from it, written per parameter group:
 *
 *   {"format": "voice-simulator/voice", "version": 1, "name": "Anna",
 *    "preset": "female", "folds": {"pitch": 205}}
 *
 * `accent` (optional) is the accent the voice speaks with: an accent code
 * (`"en-x-ru"`, see src/accent/) or `{"code": "en-x-ru", "strength": 0.5}`;
 * an accent option of synthesize wins over it.
 *
 * loadVoice also reads the older forms, a flat head object
 * (`{"pitch": 205}`) and the `key=value&...` fragment of encodeHeadConfig,
 * and reports every problem of a file at once: a wrong format, a newer
 * version, an unknown group, preset or key, a key in the wrong group and
 * a value that is not a finite number or lies outside its range. Strict
 * loading throws one Error with one line per problem; lenient loading
 * clamps or skips and returns the lines as warnings.
 *
 * A parameter that is renamed in a later version keeps its old name in
 * RENAMED_KEYS, so files of earlier versions keep loading.
 */

import {
  DEFAULT_HEAD,
  HEAD_GROUPS,
  HEAD_PARAMETERS,
  HEAD_PRESETS,
  getHeadParameter,
  normalizeHeadConfig,
  presetHeadConfig,
} from './head-config.js';
import { getAccent } from './accent/index.js';
import { ACCENTS } from './g2p/accents.js';

/** Value of the `format` field of a voice file. */
export const VOICE_FORMAT = 'voice-simulator/voice';

/** Version of the voice file format that this code writes. */
export const VOICE_VERSION = 1;

/** Old parameter names and the names that replaced them (none yet). */
export const RENAMED_KEYS = Object.freeze({});

/** Top-level fields of a voice file other than the groups. */
const META_KEYS = [
  'format',
  'version',
  'name',
  'description',
  'preset',
  'accent',
  'articulationOffsets',
];

const OFFSET_CHANNELS = ['height', 'backness', 'rounding'];

function readOffsets(offsets, report) {
  if (offsets === undefined) {
    return undefined;
  }
  if (!isPlainObject(offsets)) {
    report('articulationOffsets must be an object');
    return undefined;
  }
  const entries = [];
  for (const [ipa, channels] of Object.entries(offsets)) {
    if (!ipa || !isPlainObject(channels)) {
      report(`invalid articulationOffsets entry "${ipa}"`);
      continue;
    }
    const values = Object.entries(channels).filter(([name, value]) => {
      const valid =
        OFFSET_CHANNELS.includes(name) &&
        Number.isFinite(value) &&
        Math.abs(value) <= 0.15;
      if (!valid) {
        report(`invalid articulationOffsets value "${ipa}.${name}"`);
      }
      return valid;
    });
    if (values.length) {
      entries.push([ipa, Object.fromEntries(values)]);
    }
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Units that are not written after a number ('1' plain, 'x' factor). */
const SILENT_UNITS = new Set(['1', 'x']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `60 to 320 Hz`: the range of a parameter with its unit. */
function rangeText(parameter) {
  const unit = SILENT_UNITS.has(parameter.unit) ? '' : ` ${parameter.unit}`;
  return `${parameter.min} to ${parameter.max}${unit}`;
}

/**
 * Reads the parameters of one source of values into `values`, reporting
 * each problem through `report(line)`.
 */
function readValue(values, name, key, raw, report) {
  const parameter = getHeadParameter(key);
  const value =
    typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    report(`${name} = ${JSON.stringify(raw)} is not a finite number`);
    return;
  }
  if (value < parameter.min || value > parameter.max) {
    report(`${name} = ${value} is outside ${rangeText(parameter)}`);
    values[key] = Math.min(parameter.max, Math.max(parameter.min, value));
    return;
  }
  values[key] = value;
}

/** The current name of a key (RENAMED_KEYS) and its parameter, if any. */
function currentKey(key) {
  const renamed = Object.hasOwn(RENAMED_KEYS, key) ? RENAMED_KEYS[key] : key;
  return getHeadParameter(renamed) ? renamed : null;
}

/** Reads a flat `{key: value}` object (the head object of the API). */
function readFlat(entries, values, report) {
  for (const [written, raw] of entries) {
    const key = currentKey(written);
    if (key) {
      readValue(values, written, key, raw, report);
    } else {
      report(`unknown key "${written}"`);
    }
  }
}

/** Reads one group object of a voice file. */
function readGroup(group, object, values, report) {
  if (!isPlainObject(object)) {
    report(`${group} must be an object of parameter values`);
    return;
  }
  for (const [written, raw] of Object.entries(object)) {
    const key = currentKey(written);
    const name = `${group}.${written}`;
    if (!key) {
      report(`unknown key "${name}"`);
      continue;
    }
    const parameter = getHeadParameter(key);
    if (parameter.group !== group) {
      report(`${name} belongs to the group ${parameter.group}`);
    }
    readValue(values, name, key, raw, report);
  }
}

function checkFormat(voice, report) {
  if (voice.format === undefined) {
    report(`format is missing (expected "${VOICE_FORMAT}")`);
  } else if (voice.format !== VOICE_FORMAT) {
    report(
      `format is ${JSON.stringify(voice.format)}, expected "${VOICE_FORMAT}"`
    );
  }
  const { version } = voice;
  if (version === undefined) {
    report(`version is missing (expected ${VOICE_VERSION})`);
  } else if (!Number.isInteger(version) || version < 1) {
    report(`version ${JSON.stringify(version)} is not a positive integer`);
  } else if (version > VOICE_VERSION) {
    report(
      `version ${version} is newer than this voice-simulator reads (${VOICE_VERSION}); update voice-simulator`
    );
  }
}

/** The preset name of a voice, or null; reports an unknown one. */
function readPreset(preset, report) {
  if (preset === undefined || preset === null) {
    return null;
  }
  if (typeof preset === 'string' && Object.hasOwn(HEAD_PRESETS, preset)) {
    return preset;
  }
  report(
    `unknown preset ${JSON.stringify(preset)} (use ${Object.keys(HEAD_PRESETS).join(', ')})`
  );
  return null;
}

/**
 * The accent of a voice (a code, or `{code, strength}`), or null; reports
 * an unknown code or a strength outside 0 to 1.
 */
function readAccent(accent, report) {
  if (accent === undefined || accent === null) {
    return null;
  }
  const object = isPlainObject(accent);
  const code = object ? accent.code : accent;
  if (typeof code !== 'string' || getAccent(code) === null) {
    report(
      `unknown accent ${JSON.stringify(code)} (use a code of docs/accents.md)`
    );
    return null;
  }
  if (!object) {
    return getAccent(code).code;
  }
  const extra = Object.keys(accent).filter(
    (key) => key !== 'code' && key !== 'strength'
  );
  if (extra.length > 0) {
    report(`unknown accent field "${extra[0]}" (use code, strength)`);
  }
  const { strength } = accent;
  if (
    strength !== undefined &&
    !(typeof strength === 'number' && strength >= 0 && strength <= 1)
  ) {
    report('accent.strength must be a number from 0 to 1');
    return null;
  }
  return strength === undefined
    ? getAccent(code).code
    : { code: getAccent(code).code, strength };
}

function readText(voice, field, report) {
  const value = voice[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    report(`${field} must be a string`);
    return null;
  }
  return value;
}

/** Reads a voice file object (format, version, groups). */
function readVoiceObject(voice, values, report) {
  checkFormat(voice, report);
  for (const [field, object] of Object.entries(voice)) {
    if (HEAD_GROUPS.includes(field)) {
      readGroup(field, object, values, report);
    } else if (!META_KEYS.includes(field)) {
      report(
        `unknown group "${field}" (use ${HEAD_GROUPS.join(', ')}, or ${META_KEYS.join(', ')})`
      );
    }
  }
  const articulationOffsets = readOffsets(voice.articulationOffsets, report);
  return {
    name: readText(voice, 'name', report),
    description: readText(voice, 'description', report),
    preset: readPreset(voice.preset, report),
    accent: readAccent(voice.accent, report),
    ...(articulationOffsets && { articulationOffsets }),
  };
}

/** True for a voice file object, false for a flat head object. */
function isVoiceObject(object) {
  return Object.entries(object).some(
    ([key, value]) => META_KEYS.includes(key) || isPlainObject(value)
  );
}

/** Reads the `key=value&...` fragment of encodeHeadConfig. */
function readQuery(text, values, report) {
  const entries = [];
  let preset;
  for (const pair of text.replace(/^[?#]/, '').split('&')) {
    if (pair === '') {
      continue;
    }
    const [key, value = ''] = pair.split('=').map(decodeURIComponent);
    if (key === 'preset') {
      preset = value;
    } else {
      entries.push([key, value]);
    }
  }
  readFlat(entries, values, report);
  return {
    name: null,
    description: null,
    preset: readPreset(preset, report),
    accent: null,
  };
}

/** Parses JSON text; reports a syntax error. */
function parseJson(text, report) {
  try {
    return JSON.parse(text);
  } catch (error) {
    report(`not valid JSON: ${error.message}`);
    return null;
  }
}

/** Reads any input form into `values`; returns the name, description and preset. */
function readInput(input, values, report) {
  const empty = { name: null, description: null, preset: null, accent: null };
  let object = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text.startsWith('{')) {
      return readQuery(text, values, report);
    }
    object = parseJson(text, report);
    if (object === null) {
      return empty;
    }
  }
  if (!isPlainObject(object)) {
    report(
      'a voice must be a voice file object, a flat head object or a key=value&... string'
    );
    return empty;
  }
  if (isVoiceObject(object)) {
    return readVoiceObject(object, values, report);
  }
  readFlat(Object.entries(object), values, report);
  return empty;
}

/**
 * Read a voice.
 * @param {object|string} input A voice file object or its JSON text, a
 *   flat head object, or a `key=value&...` fragment.
 * @param {{strict?: boolean}} [options] strict (default true): throw one
 *   Error with one line per problem; false: clamp out-of-range values,
 *   skip the others and return the lines as `warnings`.
 * @returns {{name: string|null, description: string|null, preset: string|null,
 *   accent: string|{code: string, strength: number}|null,
 *   head: Record<string, number>, warnings: string[]}} `head` is complete:
 *   the values the voice leaves out come from its preset (presetHeadConfig
 *   at size 0.5) or the defaults.
 */
export function loadVoice(input, { strict = true } = {}) {
  const problems = [];
  const values = {};
  const meta = readInput(input, values, (line) => problems.push(line));
  if (strict && problems.length > 0) {
    const error = new Error(problems.join('\n'));
    error.problems = problems;
    throw error;
  }
  const base = meta.preset ? presetHeadConfig(meta.preset, 0.5) : DEFAULT_HEAD;
  return {
    ...meta,
    head: normalizeHeadConfig({ ...base, ...values }),
    warnings: problems,
  };
}

/**
 * Write a voice file object (JSON.stringify it to save it).
 * @param {{head?: Record<string, number>, preset?: string|null,
 *   name?: string|null, description?: string|null,
 *   accent?: string|{code: string, strength?: number}|null}|Record<string, number>} voice
 *   A voice as loadVoice returns it, or a flat head object.
 * @param {{full?: boolean}} [options] full: write every value; by default
 *   only the values that differ from the preset (or the defaults) are written.
 */
export function saveVoice(voice, { full = false } = {}) {
  const hasHead = isPlainObject(voice?.head);
  const head = normalizeHeadConfig(hasHead ? voice.head : voice);
  const preset = hasHead ? readPreset(voice.preset, () => {}) : null;
  const file = { format: VOICE_FORMAT, version: VOICE_VERSION };
  for (const field of ['name', 'description']) {
    if (hasHead && typeof voice[field] === 'string' && voice[field] !== '') {
      file[field] = voice[field];
    }
  }
  if (preset) {
    file.preset = preset;
  }
  const accent = hasHead ? readAccent(voice.accent, () => {}) : null;
  if (accent) {
    file.accent = accent;
  }
  const articulationOffsets = readOffsets(voice?.articulationOffsets, () => {});
  if (articulationOffsets) {
    file.articulationOffsets = articulationOffsets;
  }
  return Object.assign(file, groupValues(head, preset, full));
}

/** The values of `head` per group: all, or those that differ from the preset. */
function groupValues(head, preset, full) {
  const base = preset ? presetHeadConfig(preset, 0.5) : DEFAULT_HEAD;
  const groups = {};
  for (const parameter of HEAD_PARAMETERS) {
    const { key, group } = parameter;
    if (full || head[key] !== base[key]) {
      groups[group] ??= {};
      groups[group][key] = head[key];
    }
  }
  return Object.fromEntries(
    HEAD_GROUPS.filter((group) => groups[group]).map((group) => [
      group,
      groups[group],
    ])
  );
}

function parameterSchema(parameter) {
  const unit = SILENT_UNITS.has(parameter.unit)
    ? parameter.unit === 'x'
      ? ' (factor)'
      : ''
    : ` (${parameter.unit})`;
  return {
    type: 'number',
    title: `${parameter.label}${unit}`,
    description: parameter.description,
    minimum: parameter.min,
    maximum: parameter.max,
    default: parameter.default,
  };
}

/** Every accent code of ACCENTS. */
function accentCodes() {
  return Object.values(ACCENTS).flatMap((list) => list.map(({ code }) => code));
}

/**
 * JSON Schema (draft 2020-12) of a voice file; schemas/voice.schema.json
 * holds its output.
 */
export function voiceSchema() {
  const properties = {
    format: { const: VOICE_FORMAT },
    version: { type: 'integer', minimum: 1, maximum: VOICE_VERSION },
    name: { type: 'string' },
    description: { type: 'string' },
    preset: {
      description:
        'Head preset that supplies the values the file leaves out (size 0.5).',
      enum: Object.keys(HEAD_PRESETS),
    },
    accent: {
      description:
        'Accent the voice speaks with (docs/accents.md): a code, or a code with a strength from 0 to 1.',
      oneOf: [
        { type: 'string', enum: accentCodes() },
        {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: {
            code: { type: 'string', enum: accentCodes() },
            strength: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      ],
    },
  };
  for (const group of HEAD_GROUPS) {
    properties[group] = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        HEAD_PARAMETERS.filter((parameter) => parameter.group === group).map(
          (parameter) => [parameter.key, parameterSchema(parameter)]
        )
      ),
    };
  }
  properties.articulationOffsets = {
    type: 'object',
    propertyNames: { minLength: 1 },
    additionalProperties: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        OFFSET_CHANNELS.map((name) => [
          name,
          { type: 'number', minimum: -0.15, maximum: 0.15 },
        ])
      ),
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/konard/voice-simulator/blob/main/schemas/voice.schema.json',
    title: 'voice-simulator voice',
    description:
      'A voice: a preset plus the head values that differ from it, per parameter group (docs/VOICE-PARAMETERS.md).',
    type: 'object',
    required: ['format', 'version'],
    additionalProperties: false,
    properties,
  };
}
