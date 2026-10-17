/**
 * Every voice-affecting constant is a head parameter: its default keeps the
 * old sound, and any other value changes the rendered audio.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { HEAD_PARAMETERS, normalizeHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const IPA = 'ˈmasa ˈna';
const NEW_KEYS = [
  'jitter',
  'shimmer',
  'vibratoRate',
  'aspirationLevel',
  'declination',
  'accentStrength',
  'stressLengthening',
  'finalLengthening',
  'pauseLength',
  'articulationSpeed',
  'wallLoss',
  'nasalCoupling',
  'fricationLevel',
  'outputGain',
];

function render(overrides = {}) {
  const head = normalizeHeadConfig(overrides);
  const plan = planUtterance(IPA, { head });
  return { plan, samples: renderPlan(plan, { sampleRate: RATE, seed: 3 }) };
}

function differs(first, second) {
  if (first.length !== second.length) {
    return true;
  }
  return first.some((value, index) => value !== second[index]);
}

describe('head parameters', () => {
  it('groups the voice-shaping constants as parameters', () => {
    const keys = HEAD_PARAMETERS.map((parameter) => parameter.key);
    for (const key of NEW_KEYS) {
      expect(keys.includes(key)).toBe(true);
    }
    for (const parameter of HEAD_PARAMETERS) {
      expect(parameter.default >= parameter.min).toBe(true);
      expect(parameter.default <= parameter.max).toBe(true);
      expect(typeof parameter.description).toBe('string');
    }
  });

  it('changes the audio when any new parameter moves off its default', () => {
    const base = render().samples;
    for (const key of NEW_KEYS) {
      const parameter = HEAD_PARAMETERS.find((entry) => entry.key === key);
      const value =
        parameter.default + (parameter.max - parameter.default) * 0.5;
      const changed = differs(base, render({ [key]: value }).samples);
      expect([key, changed]).toEqual([key, true]);
    }
  });

  it('moves timing and level in the expected direction', () => {
    const base = render();
    const slow = render({ pauseLength: 2, finalLengthening: 1.8 });
    expect(slow.plan.duration > base.plan.duration).toBe(true);
    const quiet = render({ outputGain: 0.5 });
    expect(
      rms(quiet.samples, 0, quiet.samples.length) <
        rms(base.samples, 0, base.samples.length)
    ).toBe(true);
  });
});
