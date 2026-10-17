import { describe, it, expect } from 'test-anywhere';
import { DEFAULT_HEAD, ROOM_PRESETS, synthesize } from '../src/index.js';
import {
  DEFAULT_ACOUSTICS,
  boxProblem,
  enclosureCells,
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

  it('accepts the default box on every tier and flags boxes that cannot work', () => {
    const box = { ...DEFAULT_ACOUSTICS, box: true };

    expect(boxProblem(DEFAULT_ACOUSTICS, DEFAULT_HEAD)).toBe(null);
    expect(boxProblem(box, DEFAULT_HEAD)).toBe(null);
    expect(enclosureCells(box, 1)).toBe(30 * 44 * 30);

    const large = { ...box, boxWidth: 60, boxHeight: 60, boxDepth: 60 };
    expect(boxProblem(large, DEFAULT_HEAD)).toEqual({ tiers: ['ultra'] });

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
