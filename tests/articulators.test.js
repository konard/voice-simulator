/**
 * Free articulators (issue 40): jaw, lip protrusion, larynx height and
 * tongue root as channels of the plan. At their defaults the tract keeps
 * its shape; moved alone they shift the formants of the waveguide as
 * Lindblom & Sundberg (1971) describe for their articulatory model.
 */

import { describe, it, expect } from 'test-anywhere';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { planUtterance } from '../src/articulation/plan.js';
import { teethGap } from '../src/articulation/teeth.js';
import {
  LIP_PROTRUSION,
  sampleState,
  stretchSections,
  tractShape,
} from '../src/articulation/tract-shape.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';

/** First four formants (Hz) of a tract shape: waveguide impulse response. */
function formants(shape) {
  const sections = shape.areas.length;
  const solver = new Waveguide({ sections });
  solver.setShape(shape.areas, 0, shape.velumIndex);
  solver.setLength(shape.length);
  const rate = (sections * SPEED_OF_SOUND) / shape.length;
  const response = new Float64Array(Math.round(0.06 * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, {
    from: 150,
    to: 5000,
    step: 4,
    prominence: 1,
  }).slice(0, 4);
}

/** Relative change (%) of each formant. */
function changes(before, after) {
  return after.map((value, index) => (100 * value) / before[index] - 100);
}

function vowel(symbol) {
  const [height, backness, rounding] = STORY_FEATURES[symbol] ?? [0.5, 0.5, 0];
  return { height, backness, rounding, rhotic: 0 };
}

/** Channels in the middle of the first consonant of `ipa`. */
function consonantMiddle(ipa) {
  const plan = planUtterance(ipa);
  const segment = plan.segments.find((entry) => entry.kind === 'consonant');
  return sampleState(plan, (segment.start + segment.end) / 2);
}

/** Distance (cm) of the velum from the lips. */
function velumFromLips(shape) {
  return shape.length * (1 - (shape.velumIndex + 0.5) / shape.areas.length);
}

function meanVowelF0(ipa, head, part = 1) {
  const plan = planUtterance(ipa, { head });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  let sum = 0;
  let count = 0;
  const end =
    (segment.start + (segment.end - segment.start) * part) * plan.frameRate;
  for (let frame = Math.ceil(segment.start * plan.frameRate); frame < end; ) {
    sum += plan.channels.f0[frame++];
    count++;
  }
  return sum / count;
}

describe('free articulators', () => {
  it('keeps the default shape', () => {
    const states = Object.keys(STORY_FEATURES).map(vowel);
    for (const ipa of ['ˈəsə', 'ˈəmə', 'ˈəkə']) {
      // The channels the planned jaw and lips follow.
      const { jaw, lipProtrusion, ...state } = consonantMiddle(ipa);
      expect([jaw > 0, lipProtrusion >= 0]).toEqual([true, true]);
      states.push(state);
    }
    for (const state of states) {
      const implied = tractShape(state, DEFAULT_HEAD);
      const explicit = tractShape(
        {
          ...state,
          jaw: teethGap(state, DEFAULT_HEAD),
          lipProtrusion: LIP_PROTRUSION * state.rounding,
          larynxHeight: 0,
          tongueRoot: 0,
        },
        DEFAULT_HEAD
      );
      expect(explicit.length).toBe(implied.length);
      expect(explicit.velumIndex).toBe(implied.velumIndex);
      expect(explicit.teeth).toEqual(implied.teeth);
      implied.areas.forEach((area, index) => {
        expect(Math.abs(explicit.areas[index] - area)).toBeLessThan(1e-12);
      });
    }
  });

  it('stretches sections keeping the volume of the tract', () => {
    const areas = [1, 2, 3, 4];
    const { areas: stretched, length } = stretchSections(
      areas,
      [1, 1, 2, 1],
      5
    );
    expect(length).toBe(5);
    const volume = stretched.reduce((sum, area) => sum + area, 0);
    expect(Math.abs(volume - (1 + 2 + 6 + 4))).toBeLessThan(1e-12);
    expect(Array.from(stretched)).toEqual([1, 2, 3, 3, 4]);
  });

  it('lowers all formants with a lower larynx', () => {
    const state = vowel('ɑ');
    const base = tractShape(state, DEFAULT_HEAD);
    const low = tractShape({ ...state, larynxHeight: -1 }, DEFAULT_HEAD);
    expect(Math.abs(low.length - base.length - 1)).toBeLessThan(1e-9);
    for (const change of changes(formants(base), formants(low))) {
      expect(change).toBeLessThan(-1);
      expect(change).toBeGreaterThan(-9);
    }
  });

  it('keeps the velum in place when the larynx moves', () => {
    const state = vowel('ɑ');
    const base = tractShape(state, DEFAULT_HEAD);
    const low = tractShape({ ...state, larynxHeight: -1 }, DEFAULT_HEAD);
    expect(Math.abs(velumFromLips(low) - velumFromLips(base))).toBeLessThan(
      low.length / low.areas.length
    );
  });

  it('lowers F3 with protruded lips and raises it with spread ones', () => {
    const state = vowel('i');
    const base = formants(tractShape(state, DEFAULT_HEAD));
    const protruded = formants(
      tractShape({ ...state, lipProtrusion: 0.6 }, DEFAULT_HEAD)
    );
    expect(changes(base, protruded)[2]).toBeLessThan(-3);
    const spread = formants(
      tractShape(state, normalizeHeadConfig({ lipPosture: -0.3 }))
    );
    expect(changes(base, spread)[2]).toBeGreaterThan(0);
  });

  it('raises F1 with a more open jaw', () => {
    const state = vowel('ɛ');
    const base = formants(tractShape(state, DEFAULT_HEAD));
    const open = formants(
      tractShape(
        { ...state, jaw: teethGap(state, DEFAULT_HEAD) + 0.5 },
        DEFAULT_HEAD
      )
    );
    const [first] = changes(base, open);
    expect(first).toBeGreaterThan(8);
    expect(first).toBeLessThan(15);
  });

  it('raises F1 and lowers F2 with a retracted tongue root', () => {
    const state = vowel('ə');
    const base = formants(tractShape(state, DEFAULT_HEAD));
    const back = formants(
      tractShape({ ...state, tongueRoot: -1 }, DEFAULT_HEAD)
    );
    const [first, second] = changes(base, back);
    expect(first).toBeGreaterThan(5);
    expect(second).toBeLessThan(0);
  });

  it('moves the jaw slower than the tongue', () => {
    const state = consonantMiddle('ata');
    expect(state.jaw).toBeGreaterThan(
      teethGap({ ...state, jaw: undefined }, DEFAULT_HEAD)
    );
  });

  it('raises the pitch of close vowels with intrinsicPitch', () => {
    const semitones = (head, part) =>
      12 *
      Math.log2(
        meanVowelF0('ˈmi', head, part) / meanVowelF0('ˈma', head, part)
      );
    // The statement fall of the nucleus (issue 51) undershoots its low
    // target in the shorter /i/, so over the whole vowel the two differ
    // by their durations; the vowel quality alone is compared before
    // the fall and as the change that intrinsicPitch adds.
    const head = normalizeHeadConfig({ intrinsicPitch: 2 });
    const intrinsic = semitones(head, 1) - semitones(DEFAULT_HEAD, 1);
    expect(intrinsic).toBeGreaterThan(1.5);
    expect(intrinsic).toBeLessThan(2.5);
    expect(semitones(head, 0.5)).toBeGreaterThan(1.5);
    expect(Math.abs(semitones(DEFAULT_HEAD, 0.5))).toBeLessThan(0.1);
  });
});
