/**
 * Articulatory planning and the vocal tract area model.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  planUtterance,
  smoothChannel,
  CONTROL_RATE,
} from '../src/articulation/plan.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  DEFAULT_HEAD,
  normalizeHeadConfig,
  presetHeadConfig,
} from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

function vowelFormants(symbol, head = DEFAULT_HEAD, branches = () => []) {
  const target = vowelTarget({ phoneme: getPhoneme(symbol) });
  const shape = tractShape({ ...target, rhotic: 0 }, head);
  return tubeFormants(shape.areas, shape.length, {
    count: 3,
    branches: branches(shape),
  });
}

function segmentMiddle(plan, kind, symbol) {
  const segment = plan.segments.find(
    (item) => item.kind === kind && (!symbol || item.token?.base === symbol)
  );
  return (segment.start + segment.end) / 2;
}

describe('planUtterance', () => {
  it('splits a voiceless plosive into closure and release', () => {
    const plan = planUtterance('ˈpa');
    expect(plan.segments.map((segment) => segment.kind)).toEqual([
      'pause',
      'consonant',
      'release',
      'vowel',
      'pause',
    ]);
    expect(plan.frameRate).toBe(CONTROL_RATE);
    expect(plan.channels.f0.length).toBe(plan.frameCount);
  });

  it('starts and ends silent', () => {
    const plan = planUtterance('ˈma');
    expect(plan.channels.loudness[0]).toBeLessThan(0.05);
    expect(plan.channels.loudness.at(-1)).toBeLessThan(0.05);
    const vowel = sampleState(plan, segmentMiddle(plan, 'vowel'));
    expect(vowel.loudness).toBeGreaterThan(0.9);
  });

  it('follows the head pitch and rises for questions', () => {
    const head = normalizeHeadConfig({ pitch: 200, vibrato: 0 });
    const statement = planUtterance('ˈma ˈma .', { head });
    const question = planUtterance('ˈma ˈma ?', { head });
    const middle = sampleState(statement, segmentMiddle(statement, 'vowel'));
    expect(Math.abs(middle.f0 - 200) / 200).toBeLessThan(0.25);
    const lastVowel = (plan) =>
      plan.segments.filter((segment) => segment.kind === 'vowel').at(-1);
    const end = (plan) => sampleState(plan, lastVowel(plan).end - 0.01).f0;
    expect(end(question)).toBeGreaterThan(end(statement) * 1.1);
  });

  it('uses Mandarin tone contours', () => {
    const head = normalizeHeadConfig({ vibrato: 0 });
    const plan = planUtterance('ma˥˩', { head, language: 'zh' });
    const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
    const span = vowel.end - vowel.start;
    const early = sampleState(plan, vowel.start + span * 0.2).f0;
    const late = sampleState(plan, vowel.end - span * 0.1).f0;
    expect(early).toBeGreaterThan(late * 1.15);
  });

  it('opens the velum for nasals only', () => {
    const plan = planUtterance('ˈama');
    expect(
      sampleState(plan, segmentMiddle(plan, 'consonant')).velum
    ).toBeGreaterThan(0.6);
    expect(sampleState(plan, plan.segments[1].start + 0.03).velum).toBeLessThan(
      0.3
    );
  });
});

describe('smoothChannel', () => {
  it('turns steps into continuous trajectories without lag', () => {
    const values = new Float32Array(200);
    values.fill(1, 100);
    smoothChannel(values, 0.02, CONTROL_RATE);
    let largestStep = 0;
    for (let index = 1; index < values.length; index++) {
      largestStep = Math.max(largestStep, values[index] - values[index - 1]);
    }
    expect(largestStep).toBeLessThan(0.3);
    expect(Math.abs(values[99] + values[100] - 1)).toBeLessThan(0.1);
  });
});

describe('tractShape', () => {
  it('matches the mean vowel formants of men on the male head', () => {
    const head = presetHeadConfig('male');
    const fossae = (shape) => [
      piriformBranch(shape.areas.length, shape.length, head),
    ];
    for (const symbol of [
      'i',
      'ɪ',
      'e',
      'ɛ',
      'æ',
      'ʌ',
      'ɑ',
      'ɔ',
      'o',
      'ʊ',
      'u',
    ]) {
      const formants = vowelFormants(symbol, head, fossae);
      HILLENBRAND.male[symbol].forEach((expected, index) => {
        const error = Math.abs(formants[index] - expected);
        expect(error / expected).toBeLessThan(0.1);
      });
    }
  });

  it('lowers formants for a longer vocal tract', () => {
    const short = vowelFormants(
      'ə',
      normalizeHeadConfig({ vocalTractLength: 13 })
    );
    const long = vowelFormants(
      'ə',
      normalizeHeadConfig({ vocalTractLength: 19 })
    );
    expect(long[0]).toBeLessThan(short[0]);
    expect(long[1]).toBeLessThan(short[1]);
  });

  it('lowers F3 for the rhotic vowel', () => {
    const shape = tractShape(
      { height: 0.5, backness: 0.5, rounding: 0, rhotic: 1 },
      DEFAULT_HEAD
    );
    const formants = tubeFormants(shape.areas, shape.length, { count: 3 });
    expect(formants[2]).toBeLessThan(2200);
  });

  it('closes the lips for /p/ and the alveolar ridge for /t/', () => {
    for (const [ipa, region] of [
      ['ˈapa', [40, 44]],
      ['ˈata', [30, 42]],
    ]) {
      const plan = planUtterance(ipa);
      const state = sampleState(plan, segmentMiddle(plan, 'consonant'));
      const { areas } = tractShape(state, plan.head);
      const narrowest = Math.min(...areas.slice(region[0], region[1]));
      expect(narrowest).toBeLessThan(0.01);
    }
  });

  it('places the fricative source at the constriction', () => {
    const plan = planUtterance('ˈasa');
    const state = sampleState(plan, segmentMiddle(plan, 'consonant'));
    const shape = tractShape(state, plan.head);
    expect(shape.frication.gain).toBeGreaterThan(0.3);
    expect(shape.frication.position).toBeGreaterThan(35);
    expect(shape.frication.sibilance).toBeGreaterThan(0.5);
  });
});
