/**
 * Every voice-affecting constant is a head parameter: its default keeps the
 * old sound, and any other value changes the rendered audio.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { impulseSpectrum, resonances, rms } from '../src/acoustics/analysis.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { STORY_AREAS, STORY_LENGTHS } from '../src/articulation/vowel-space.js';
import { HEAD_PARAMETERS, normalizeHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const IPA = 'ˈmasa ˈna';
const NEW_KEYS = [
  'glottalChink',
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
  'wallMass',
  'wallResistance',
  'wallStiffness',
  'nasalCoupling',
  'nasalLoss',
  'fricationLevel',
  'outputGain',
];

function render(overrides = {}) {
  const head = normalizeHeadConfig(overrides);
  const plan = planUtterance(IPA, { head });
  return { plan, samples: renderPlan(plan, { sampleRate: RATE, seed: 3 }) };
}

/** F1 of [i] in the waveguide (closed glottis) and its peak level. */
function firstFormant(overrides) {
  const areas = STORY_AREAS.i;
  const length = STORY_LENGTHS.i;
  const head = normalizeHeadConfig(overrides);
  const solver = new Waveguide({ sections: areas.length, head });
  solver.setShape(areas, 0, Math.round(areas.length * 0.45));
  solver.setLength(length);
  solver.glottalReflection = 1;
  const rate = (areas.length * SPEED_OF_SOUND) / length;
  const response = new Float64Array(Math.round(0.25 * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  const spectrum = impulseSpectrum(response, rate, {
    from: 150,
    to: 600,
    step: 1,
  });
  const [{ frequency }] = resonances(spectrum, { count: 1 });
  return { frequency, level: Math.max(...spectrum.magnitudes) };
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

  it('lowers the nasal murmur with higher nasal losses', () => {
    const level = (nasalLoss) => {
      const head = normalizeHeadConfig({ nasalLoss });
      const plan = planUtterance('ˈama', { head });
      const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
      const nasal = plan.segments.find((item) => item.kind === 'consonant');
      return rms(
        samples,
        Math.floor(nasal.start * RATE),
        Math.floor(nasal.end * RATE)
      );
    };
    const parameter = HEAD_PARAMETERS.find(
      (entry) => entry.key === 'nasalLoss'
    );
    expect(level(parameter.max)).toBeLessThan(0.9 * level(parameter.default));
    // The boundary-layer loss of the nose grows with sqrt(f) (issue 36) and
    // is small at the murmur (about 250 Hz), so the low end of nasalLoss
    // moves it less than the flat loss of earlier versions did (-4 %
    // instead of -21 %; experiments/issue-36-nasal-murmur.mjs).
    expect(level(parameter.default)).toBeLessThan(0.97 * level(parameter.min));
  });

  it('damps and lowers F1 with lossier and heavier walls', () => {
    const base = firstFormant({});
    const resistive = firstFormant({ wallResistance: 2400 });
    expect(resistive.level).toBeLessThan(base.level);
    const heavy = firstFormant({ wallMass: 3 });
    expect(heavy.frequency).toBeLessThan(base.frequency);
  });
});
