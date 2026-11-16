/**
 * Every voice-affecting constant is a head parameter: its default keeps the
 * old sound, and any other value changes the rendered audio. Every entry
 * documents its unit, range, source and the direction in which it moves a
 * measure of the sound (issue 41), and that direction is what renders.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { impulseSpectrum, resonances, rms } from '../src/acoustics/analysis.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { STORY_AREAS, STORY_LENGTHS } from '../src/articulation/vowel-space.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import {
  HEAD_GROUPS,
  HEAD_PARAMETERS,
  normalizeHeadConfig,
} from '../src/head-config.js';
import { readFileSync } from 'node:fs';
import {
  DOCS_FILE,
  voiceParametersMarkdown,
} from '../scripts/voice-parameters.mjs';
import { MEASURES, measureEffect } from './helpers/voice-measures.js';

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
  'coarticulation',
  'wallLoss',
  'wallMass',
  'wallResistance',
  'wallStiffness',
  'nasalCoupling',
  'nasalLoss',
  'fricationLevel',
  'outputGain',
  'jawPosture',
  'lipPosture',
  'larynxPosture',
  'tongueRootPosture',
  'intrinsicPitch',
  'larynxPitch',
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

/** Plan of `ipa` and the tract in the middle of its first vowel. */
function vowelMiddle(ipa, overrides = {}) {
  const head = normalizeHeadConfig(overrides);
  const plan = planUtterance(ipa, { head });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const state = sampleState(plan, (segment.start + segment.end) / 2);
  return { plan, state, shape: tractShape(state, head) };
}

/** Mean cross-section (cm²) of the sections from `from` to `to` (0..1). */
function meanArea(shape, from, to) {
  const first = Math.round(from * (shape.areas.length - 1));
  const last = Math.round(to * (shape.areas.length - 1));
  let sum = 0;
  for (let index = first; index <= last; index++) {
    sum += shape.areas[index];
  }
  return sum / (last - first + 1);
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

  it('moves the free articulators and their postures as named', () => {
    // Channels: the planned jaw opens for [a] and closes for [i], the lips
    // protrude for [u], larynx and tongue root rest at 0.
    const a = vowelMiddle('ˈma');
    const i = vowelMiddle('ˈmi');
    const u = vowelMiddle('ˈmu');
    expect(a.state.jaw).toBeGreaterThan(i.state.jaw + 0.5);
    expect(u.state.lipProtrusion).toBeGreaterThan(0.5);
    expect(i.state.lipProtrusion).toBeLessThan(0.05);
    expect([a.state.larynxHeight, a.state.tongueRoot]).toEqual([0, 0]);
    expect(a.shape.articulators.jaw).toBe(a.state.jaw);
    // Postures: a more open jaw widens the mouth, pushed lips and a lower
    // larynx lengthen the tract, a forward tongue root widens the pharynx.
    const open = vowelMiddle('ˈma', { jawPosture: 0.3 });
    expect(open.shape.teeth.gap).toBeGreaterThan(a.shape.teeth.gap + 0.29);
    expect(meanArea(open.shape, 0.6, 1)).toBeGreaterThan(
      meanArea(a.shape, 0.6, 1)
    );
    const pushed = vowelMiddle('ˈma', { lipPosture: 0.3 });
    expect(Math.abs(pushed.shape.length - a.shape.length - 0.3)).toBeLessThan(
      1e-9
    );
    const low = vowelMiddle('ˈma', { larynxPosture: -1 });
    expect(Math.abs(low.shape.length - a.shape.length - 1)).toBeLessThan(1e-9);
    expect(low.shape.articulators.larynxHeight).toBe(-1);
    const wide = vowelMiddle('ˈma', { tongueRootPosture: 1 });
    expect(meanArea(wide.shape, 0.2, 0.4)).toBeGreaterThan(
      1.2 * meanArea(a.shape, 0.2, 0.4)
    );
    // Prosody: close vowels get a higher pitch, the larynx rises with it.
    const f0 = (entry) => entry.state.f0;
    const flat = f0(vowelMiddle('ˈmi')) / f0(vowelMiddle('ˈma'));
    const head = { intrinsicPitch: 2 };
    const raised = f0(vowelMiddle('ˈmi', head)) / f0(vowelMiddle('ˈma', head));
    expect(raised).toBeGreaterThan(flat * 2 ** (1.5 / 12));
    const coupled = vowelMiddle('ˈma ˈma ?', { larynxPitch: 0.5 }).plan;
    const plain = vowelMiddle('ˈma ˈma ?').plan;
    expect(Math.max(...coupled.channels.larynxHeight)).toBeGreaterThan(0.05);
    expect(Math.max(...plain.channels.larynxHeight)).toBe(0);
  });

  it('lowers the nasal murmur with higher nasal losses', () => {
    // The losses damp the harmonics near the murmur, so how much they
    // lower it depends on where the harmonics fall: at one head pitch the
    // level falls by 3 to 15 % (experiments/issue-51-nasal-pitch.mjs).
    // The levels are summed over four pitches.
    const level = (nasalLoss) => {
      let sum = 0;
      for (const pitch of [100, 115, 130, 145]) {
        const head = normalizeHeadConfig({ nasalLoss, pitch });
        // A stressed onset: the unstressed [m] of ˈama lasts 52 ms under
        // the duration rules of issue 39 and is mostly transition
        // (experiments/issue-39-nasal-spans.mjs).
        const plan = planUtterance('aˈma', { head });
        const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
        const nasal = plan.segments.find((item) => item.kind === 'consonant');
        sum += rms(
          samples,
          Math.floor(nasal.start * RATE),
          Math.floor(nasal.end * RATE)
        );
      }
      return sum;
    };
    const parameter = HEAD_PARAMETERS.find(
      (entry) => entry.key === 'nasalLoss'
    );
    expect(level(parameter.max)).toBeLessThan(0.9 * level(parameter.default));
    // The boundary-layer loss of the nose grows with sqrt(f) and is small
    // at the murmur (about 250 Hz), so the low end of nasalLoss moves the
    // murmur by only about 4 % (experiments/issue-36-nasal-murmur.mjs).
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

describe('head parameters: documentation (issue 41)', () => {
  it('documents every parameter', () => {
    const keys = new Set();
    for (const parameter of HEAD_PARAMETERS) {
      const { key, effect } = parameter;
      expect([key, keys.has(key)]).toEqual([key, false]);
      keys.add(key);
      expect([key, typeof parameter.unit, parameter.unit.length > 0]).toEqual([
        key,
        'string',
        true,
      ]);
      expect([key, parameter.min < parameter.max]).toEqual([key, true]);
      expect([
        key,
        parameter.default >= parameter.min &&
          parameter.default <= parameter.max,
      ]).toEqual([key, true]);
      expect([key, String(parameter.source ?? '').length >= 10]).toEqual([
        key,
        true,
      ]);
      expect([key, HEAD_GROUPS.includes(parameter.group)]).toEqual([key, true]);
      expect([key, MEASURES.includes(effect?.measure)]).toEqual([key, true]);
      expect([key, [-1, 0, 1].includes(effect.sign)]).toEqual([key, true]);
      // A value that the model does not use says why.
      expect([
        key,
        effect.sign !== 0 || String(effect.note).length > 10,
      ]).toEqual([key, true]);
    }
    // Git may check the file out with CRLF line endings on Windows.
    expect(readFileSync(DOCS_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(
      voiceParametersMarkdown()
    );
  });
});

// One test per group keeps each under the 30 s test timeout; all groups
// take about 32 s on Node.js (experiments/issue-41-effects.txt).
describe('head parameters: moves the sound in the documented direction', () => {
  for (const group of HEAD_GROUPS) {
    it(`moves the sound in the documented direction: ${group}`, () => {
      for (const parameter of HEAD_PARAMETERS) {
        if (parameter.group !== group) {
          continue;
        }
        const { difference, sign } = measureEffect(parameter);
        expect([parameter.key, parameter.effect.measure, sign]).toEqual([
          parameter.key,
          parameter.effect.measure,
          parameter.effect.sign,
        ]);
        expect(Number.isFinite(difference)).toBe(true);
      }
    });
  }
});
