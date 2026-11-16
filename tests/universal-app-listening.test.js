import { describe, it, expect } from 'test-anywhere';
import { DEFAULT_HEAD, ROOM_PRESETS, synthesize } from '../src/index.js';
import {
  DEFAULT_ACOUSTICS,
  boxProblem,
  enclosureCells,
  engineLabel,
  listeningSettings,
} from '../examples/universal-app/src/engine/listening.js';
import { strings } from '../examples/universal-app/src/i18n.js';

describe('example app listening settings', () => {
  it('adds no synthesize options for the defaults', () => {
    expect(listeningSettings(DEFAULT_ACOUSTICS)).toEqual({});
  });

  it('turns the settings into microphone, room and enclosure options', () => {
    const options = listeningSettings({
      ...DEFAULT_ACOUSTICS,
      micAzimuth: 90,
      room: 'office',
      box: true,
    });

    expect(options.microphone).toEqual({
      distance: 3,
      azimuth: 90,
      elevation: 0,
      compensate: false,
    });
    expect(options.room).toBe('office');
    expect(options.enclosure).toEqual({
      width: 30,
      height: 44,
      depth: 30,
      absorption: 0.2,
    });
    expect(
      listeningSettings({ ...DEFAULT_ACOUSTICS, micCompensate: true })
        .microphone.compensate
    ).toBe(true);
  });

  it('runs the 3D tiers on the GPU unless it is turned off', () => {
    expect(DEFAULT_ACOUSTICS.gpu).toBe(true);
    expect(listeningSettings({ ...DEFAULT_ACOUSTICS, gpu: false })).toEqual({
      gpu: false,
    });
  });

  it('renders with the engine setting, auto by default', () => {
    expect(DEFAULT_ACOUSTICS.engine).toBe('auto');
    expect(listeningSettings(DEFAULT_ACOUSTICS).engine).toBe(undefined);
    expect(listeningSettings({ ...DEFAULT_ACOUSTICS, engine: 'js' })).toEqual({
      engine: 'js',
    });
  });

  it('labels the engine of the worker', () => {
    const labels = strings('en').acoustics;
    expect(engineLabel({ name: 'rust', simd: true }, labels)).toBe(
      'Engine: Rust (SIMD)'
    );
    expect(engineLabel({ name: 'rust', simd: false }, labels)).toBe(
      'Engine: Rust'
    );
    expect(engineLabel({ name: 'js', reason: 'no wasm' }, labels)).toBe(
      'Engine: JavaScript (no wasm)'
    );
    expect(engineLabel({ name: 'js', reason: null }, labels)).toBe(
      'Engine: JavaScript'
    );
    expect(engineLabel({ name: null, error: 'x' }, labels)).toBe(
      'Engine: unavailable (x)'
    );
    expect(engineLabel(null, labels)).toBe('Engine: …');
  });

  it('accepts the default box on every tier and flags boxes that cannot work', () => {
    const box = { ...DEFAULT_ACOUSTICS, box: true };

    expect(boxProblem(DEFAULT_ACOUSTICS, DEFAULT_HEAD)).toBe(null);
    expect(boxProblem(box, DEFAULT_HEAD)).toBe(null);
    expect(enclosureCells(box, 1)).toBe(30 * 44 * 30);

    const large = { ...box, boxWidth: 60, boxHeight: 60, boxDepth: 60 };
    expect(boxProblem(large, DEFAULT_HEAD)).toEqual({
      tiers: ['ultra', 'studio', 'reference'],
    });

    const shallow = boxProblem({ ...box, boxDepth: 12 }, DEFAULT_HEAD);
    expect(shallow.message).toContain('lips');
  });

  it('renders speech with the settings the app sends', () => {
    const options = listeningSettings({
      ...DEFAULT_ACOUSTICS,
      micDistance: 50,
      room: 'studio',
      box: true,
    });
    const result = synthesize('ɑ', {
      ipa: true,
      tier: 'minimal',
      sampleRate: 16000,
      ...options,
    });

    expect(result.samples.length > 0).toBe(true);
    expect(result.samples.every(Number.isFinite)).toBe(true);
  });

  it('labels every room preset in every locale', () => {
    const english = strings('en').acoustics;
    const russian = strings('ru').acoustics;

    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
    for (const name of Object.keys(ROOM_PRESETS)) {
      expect(typeof english.rooms[name]).toBe('string');
      expect(typeof russian.rooms[name]).toBe('string');
    }
  });
});
