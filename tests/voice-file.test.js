/**
 * Voice files (issue 41): loadVoice and saveVoice round-trip every head
 * value, write only what differs from the preset, read the older flat and
 * `key=value&...` forms, report every problem of a file at once, and the
 * committed schemas/voice.schema.json is what voiceSchema writes.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import {
  DEFAULT_HEAD,
  HEAD_GROUPS,
  HEAD_PARAMETERS,
  HEAD_PRESETS,
  RENAMED_KEYS,
  VOICE_FORMAT,
  VOICE_VERSION,
  encodeHeadConfig,
  decodeHeadConfig,
  loadVoice,
  presetHeadConfig,
  randomHeadConfig,
  saveVoice,
  voiceSchema,
} from '../src/index.js';
import { SCHEMA_FILE, voiceSchemaText } from '../scripts/voice-parameters.mjs';

/** A head with every value away from its default, inside its range. */
function unusualHead() {
  return Object.fromEntries(
    HEAD_PARAMETERS.map((parameter, index) => [
      parameter.key,
      parameter.min + ((index % 7) + 1) * 0.1 * (parameter.max - parameter.min),
    ])
  );
}

describe('voice files', () => {
  it('round-trips a voice through JSON', () => {
    const head = unusualHead();
    const voice = {
      name: 'Anna',
      description: 'A test voice',
      preset: 'female',
      head,
    };
    const text = JSON.stringify(saveVoice(voice));
    const loaded = loadVoice(text);
    expect(loaded.name).toBe('Anna');
    expect(loaded.description).toBe('A test voice');
    expect(loaded.preset).toBe('female');
    expect(loaded.warnings).toEqual([]);
    expect(loaded.head).toEqual(head);
    expect(saveVoice(loaded)).toEqual(JSON.parse(text));
    // Every key also survives the URL fragment of the app.
    expect(decodeHeadConfig(encodeHeadConfig(head))).toEqual(head);
    // The default, each preset and three random heads (issue 41).
    const voices = [
      { head: DEFAULT_HEAD },
      ...Object.keys(HEAD_PRESETS).map((preset) => ({
        preset,
        head: presetHeadConfig(preset),
      })),
      ...[1, 'abc', 41].map((seed) => ({ head: randomHeadConfig(seed) })),
    ];
    for (const entry of voices) {
      expect(loadVoice(saveVoice(entry)).head).toEqual(entry.head);
      expect(loadVoice(saveVoice(entry, { full: true })).head).toEqual(
        entry.head
      );
      expect(loadVoice(saveVoice(entry.head)).head).toEqual(entry.head);
    }
  });

  it('writes only what differs from the preset or the defaults', () => {
    expect(saveVoice(DEFAULT_HEAD)).toEqual({
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
    });
    const bass = { preset: 'bass', head: presetHeadConfig('bass', 0.5) };
    expect(saveVoice(bass)).toEqual({
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
      preset: 'bass',
    });
    const anna = saveVoice({
      name: 'Anna',
      preset: 'female',
      head: { ...presetHeadConfig('female', 0.5), pitch: 205, micDistance: 1 },
    });
    expect(anna).toEqual({
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
      name: 'Anna',
      preset: 'female',
      folds: { pitch: 205 },
      microphone: { micDistance: 1 },
    });
    // The groups come in the order of HEAD_GROUPS, each key in its group.
    const full = saveVoice(DEFAULT_HEAD, { full: true });
    expect(Object.keys(full).slice(2)).toEqual(HEAD_GROUPS);
    for (const parameter of HEAD_PARAMETERS) {
      expect(full[parameter.group][parameter.key]).toBe(parameter.default);
    }
  });

  it('reads the older forms: a flat head and a key=value fragment', () => {
    expect(loadVoice({ pitch: 205, vocalTractLength: 15 }).head).toEqual({
      ...DEFAULT_HEAD,
      pitch: 205,
      vocalTractLength: 15,
    });
    const head = unusualHead();
    expect(loadVoice(encodeHeadConfig(head)).head).toEqual(head);
    expect(loadVoice(`#preset=tenor&pitch=140`).head).toEqual({
      ...presetHeadConfig('tenor', 0.5),
      pitch: 140,
    });
    expect(loadVoice(`{"pitch": 205}`).head.pitch).toBe(205);
    expect(RENAMED_KEYS).toEqual({});
    expect(Object.isFrozen(RENAMED_KEYS)).toBe(true);
  });

  it('reports every problem: an unknown key, a range and a group', () => {
    const file = {
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
      folds: { pitch: 900, wobble: 1 },
      breathing: { tenseness: 0.5 },
    };
    const lines = [
      'folds.pitch = 900 is outside 60 to 320 Hz',
      'unknown key "folds.wobble"',
      'breathing.tenseness belongs to the group folds',
    ];
    expect(() => loadVoice(file)).toThrow();
    try {
      loadVoice(file);
    } catch (error) {
      expect(error.message.split('\n')).toEqual(lines);
    }
    const lenient = loadVoice(file, { strict: false });
    expect(lenient.warnings).toEqual(lines);
    expect(lenient.head.pitch).toBe(320);
    expect(lenient.head.tenseness).toBe(0.5);
    expect(() =>
      loadVoice({ format: VOICE_FORMAT, version: 2, folds: { pitch: 120 } })
    ).toThrow();
  });

  it('reports every problem of a file at once', () => {
    const broken = {
      format: 'voice-simulator/head',
      version: VOICE_VERSION + 1,
      preset: 'robot',
      folds: { pitch: 900, foldMass: 'loud', wobble: 1 },
      breathing: { pitch: 120 },
      colour: {},
    };
    let error;
    try {
      loadVoice(broken);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error).toBe(true);
    expect(error.problems).toEqual([
      `format is "voice-simulator/head", expected "${VOICE_FORMAT}"`,
      `version ${VOICE_VERSION + 1} is newer than this voice-simulator reads (${VOICE_VERSION}); update voice-simulator`,
      'folds.pitch = 900 is outside 60 to 320 Hz',
      'folds.foldMass = "loud" is not a finite number',
      'unknown key "folds.wobble"',
      'breathing.pitch belongs to the group folds',
      `unknown group "colour" (use ${HEAD_GROUPS.join(', ')}, or format, version, name, description, preset)`,
      `unknown preset "robot" (use ${Object.keys(HEAD_PRESETS).join(', ')})`,
    ]);
    expect(error.message).toBe(error.problems.join('\n'));
    // Lenient loading clamps and skips, and returns the same lines.
    const lenient = loadVoice(broken, { strict: false });
    expect(lenient.warnings).toEqual(error.problems);
    expect(lenient.head.pitch).toBe(120);
    expect(lenient.preset).toBe(null);
    expect(() => loadVoice({ format: VOICE_FORMAT })).toThrow();
    expect(() => loadVoice('{"format": ')).toThrow();
    expect(() => loadVoice([1, 2])).toThrow();
  });
});

describe('voice schema', () => {
  it('keeps schemas/voice.schema.json current', () => {
    // Git may check the file out with CRLF line endings on Windows.
    expect(readFileSync(SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(
      voiceSchemaText()
    );
    const schema = voiceSchema();
    expect(schema.required).toEqual(['format', 'version']);
    let count = 0;
    for (const group of HEAD_GROUPS) {
      for (const [key, property] of Object.entries(
        schema.properties[group].properties
      )) {
        const parameter = HEAD_PARAMETERS.find((entry) => entry.key === key);
        expect(parameter.group).toBe(group);
        expect(property.minimum).toBe(parameter.min);
        expect(property.maximum).toBe(parameter.max);
        expect(property.default).toBe(parameter.default);
        count++;
      }
    }
    expect(count).toBe(HEAD_PARAMETERS.length);
  });
});
