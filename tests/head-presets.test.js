/**
 * Male, female and child randomization presets: the rendered voices must
 * land in the f0 and formant ranges of their speaker group.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import {
  estimateFormants,
  estimatePitch,
  spectralTilt,
} from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import {
  HEAD_PARAMETERS,
  HEAD_PRESETS,
  HEAD_PRESET_NAMES,
  presetHeadConfig,
  randomHeadConfig,
} from '../src/head-config.js';
import { synthesisOptions } from '../src/server/server.js';
import { runCli } from '../bin/voice-simulator.js';

const RATE = 16000;

function measure(head, vowel) {
  const plan = planUtterance(`ˈ${vowel}ː`, { head });
  const samples = renderPlan(plan, { sampleRate: RATE });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = (segment.start + segment.end) / 2 - 0.03;
  return {
    f0: estimatePitch(samples, RATE, { start, duration: 0.06 }),
    formants: estimateFormants(samples, RATE, {
      start,
      duration: 0.06,
      count: 3,
      // The piriform fossae add an antiresonance near 4-5 kHz that takes
      // up a pole pair; order 14 (2 + 11 kHz / 1000, even) keeps F2.
      order: 14,
    }),
  };
}

describe('head presets', () => {
  it('lists male, female and child next to the unrestricted range', () => {
    expect(HEAD_PRESET_NAMES).toEqual([
      'any',
      'male',
      'female',
      'child',
      'child5',
      'teenMale',
      'teenFemale',
      'elderlyMale',
      'elderlyFemale',
      'bass',
      'baritone',
      'tenor',
      'alto',
      'mezzo',
      'soprano',
    ]);
    for (const name of Object.keys(HEAD_PRESETS)) {
      for (const key of Object.keys(HEAD_PRESETS[name].ranges)) {
        expect(HEAD_PARAMETERS.some((entry) => entry.key === key)).toBe(true);
      }
    }
  });

  it('keeps the old random heads when no preset is given', () => {
    for (const seed of [1, 7, 'abc']) {
      expect(randomHeadConfig(seed, { preset: 'any' })).toEqual(
        randomHeadConfig(seed)
      );
    }
    expect(() => randomHeadConfig(1, { preset: 'robot' })).toThrow();
  });

  it('draws deterministic heads inside the parameter ranges', () => {
    for (const preset of ['male', 'female', 'child']) {
      const head = randomHeadConfig(5, { preset });
      expect(randomHeadConfig(5, { preset })).toEqual(head);
      for (const parameter of HEAD_PARAMETERS) {
        expect(head[parameter.key] >= parameter.min).toBe(true);
        expect(head[parameter.key] <= parameter.max).toBe(true);
      }
    }
  });

  it('orders tract length and pitch by speaker group', () => {
    let female = 0;
    let male = 0;
    let child = 0;
    for (let seed = 0; seed < 40; seed++) {
      female += randomHeadConfig(seed, { preset: 'female' }).vocalTractLength;
      male += randomHeadConfig(seed, { preset: 'male' }).vocalTractLength;
      child += randomHeadConfig(seed, { preset: 'child' }).vocalTractLength;
    }
    expect(male / 40 > 16.5).toBe(true);
    expect(female / 40 < 15.2).toBe(true);
    // Ten to twelve year olds: about 13-14 cm (Fitch and Giedd 1999).
    expect(child / 40 < 14.5).toBe(true);
    expect(child < female && female < male).toBe(true);
    expect(presetHeadConfig('female').pitch).toBeGreaterThan(
      presetHeadConfig('male').pitch * 1.6
    );
  });

  it('makes the female preset sound female (f0 and formants)', () => {
    const female = presetHeadConfig('female');
    const male = presetHeadConfig('male');
    for (const vowel of ['i', 'ə']) {
      const high = measure(female, vowel);
      const low = measure(male, vowel);
      // Hillenbrand et al. 1995: men ~131 Hz, women ~220 Hz.
      expect(high.f0).toBeGreaterThan(180);
      expect(high.f0).toBeLessThan(260);
      expect(low.f0).toBeGreaterThan(95);
      expect(low.f0).toBeLessThan(150);
      // A shorter tract raises F2 by roughly 10-25 % (women vs men).
      const ratio = high.formants[1] / low.formants[1];
      expect(ratio).toBeGreaterThan(1.1);
      expect(ratio).toBeLessThan(1.35);
    }
    for (const seed of [1, 2, 3]) {
      const voice = measure(randomHeadConfig(seed, { preset: 'female' }), 'ə');
      expect(voice.f0).toBeGreaterThan(165);
    }
  });

  it('resonates at the mean vowel formants of each speaker group', () => {
    // Tube model of the measured vowels, piriform fossae included, on the
    // mid-size head of each preset against Hillenbrand et al. (1995).
    for (const preset of ['male', 'female', 'child']) {
      const head = presetHeadConfig(preset);
      const errors = [];
      for (const [vowel, [height, backness, rounding]] of Object.entries(
        STORY_FEATURES
      )) {
        const shape = tractShape({ height, backness, rounding }, head);
        const formants = tubeFormants(shape.areas, shape.length, {
          count: 3,
          branches: [piriformBranch(shape.areas.length, shape.length, head)],
        });
        HILLENBRAND[preset][vowel].forEach((target, index) => {
          errors.push(Math.log(formants[index] / target));
        });
      }
      const rms = Math.sqrt(
        errors.reduce((sum, value) => sum + value * value, 0) / errors.length
      );
      expect(rms).toBeLessThan(preset === 'male' ? 0.03 : 0.07);
      // The worst is F2 of the child [u], whose shape is the male one
      // scaled down: -0.158 before issue 36, -0.171 with the yielding walls
      // (experiments/issue-36-presets.mjs).
      expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.18);
    }
  });

  it('accepts a preset in the CLI and the HTTP API', async () => {
    const stdout = [];
    const code = await runCli(
      ['head', '--preset', 'female', '--seed', '4', '--json'],
      { stdout: (line) => stdout.push(line), stderr: () => {} }
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout[0])).toEqual(
      randomHeadConfig('4', { preset: 'female' })
    );
    const stderr = [];
    expect(
      await runCli(['head', '--preset', 'robot'], {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      })
    ).toBe(1);
    expect(stderr[0].startsWith('Unknown head preset: robot')).toBe(true);

    const { options } = synthesisOptions({
      text: 'a',
      head: 'random',
      seed: 2,
      preset: 'child',
    });
    expect(options.head).toEqual(randomHeadConfig(2, { preset: 'child' }));
    expect(() =>
      synthesisOptions({ text: 'a', head: 'random', preset: 'robot' })
    ).toThrow();
  });
});

/** Equal to within 1e-6 (test-anywhere has no toBeCloseTo). */
function near(actual, expected) {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
}

describe('voice type presets', () => {
  it('orders the voice types', () => {
    // Issue 41: tract lengths of Fitch and Giedd (1999) and Lee, Potamianos
    // and Narayanan (1999); singers' fold lengths and f0 of Titze (1989) and
    // Roers, Mürbe and Sundberg (2009); the aged voice of Linville (2001).
    const head = (name) => presetHeadConfig(name);
    const order = (names, key) => {
      for (let index = 1; index < names.length; index++) {
        expect(head(names[index - 1])[key]).toBeGreaterThan(
          head(names[index])[key]
        );
      }
    };
    for (const names of [
      ['bass', 'baritone', 'tenor'],
      ['alto', 'mezzo', 'soprano'],
      ['bass', 'tenor', 'alto', 'soprano', 'child5'],
      ['male', 'teenMale', 'teenFemale', 'child5'],
    ]) {
      order(names, 'vocalTractLength');
      order(names, 'foldLength');
      order([...names].reverse(), 'pitch');
    }
    const expected = {
      child5: [11.5, 260],
      teenMale: [15.8, 130],
      teenFemale: [14.2, 220],
      elderlyMale: [17.2, 125],
      elderlyFemale: [14.8, 175],
      bass: [18.5, 95],
      baritone: [17.5, 110],
      tenor: [16.5, 135],
      alto: [15.3, 185],
      mezzo: [14.8, 210],
      soprano: [14.2, 240],
    };
    for (const [name, [length, pitch]] of Object.entries(expected)) {
      near(head(name).vocalTractLength, length);
      expect(Math.abs(head(name).pitch / pitch - 1)).toBeLessThan(1e-3);
      const base = /^(child|bass|baritone|tenor|teenMale|elderlyMale)/.test(
        name
      )
        ? name === 'child5'
          ? 'child'
          : 'male'
        : 'female';
      expect(HEAD_PRESETS[name].base).toBe(base);
    }
    for (const [aged, base] of [
      ['elderlyMale', 'male'],
      ['elderlyFemale', 'female'],
    ]) {
      expect(HEAD_PRESETS[aged].base).toBe(base);
      near(head(aged).jitter, head(base).jitter * 1.5);
      near(head(aged).shimmer, head(base).shimmer * 1.5);
      // The ranges: the head values are rounded to 0.01 steps.
      const range = (name) => HEAD_PRESETS[name].ranges.breathiness;
      near(range(aged)[0], range(base)[0] + 0.1);
      near(range(aged)[1], range(base)[1] + 0.1);
      near(head(aged).speechRate, 0.9);
    }
    // Rendered [a]: pitch and formants fall from soprano to bass, and the
    // five-year-old has the highest F1 to F3 of all presets
    // (experiments/issue-41-voice-types.txt). F1 of [a] falls over the whole
    // series; between soprano and mezzo LPC near f0 = 240 Hz swaps it.
    const voices = Object.fromEntries(
      Object.keys(HEAD_PRESETS).map((name) => [name, measure(head(name), 'a')])
    );
    const singers = ['soprano', 'mezzo', 'alto', 'tenor', 'baritone', 'bass'];
    const sum = (voice) => voice.formants.reduce((a, b) => a + b, 0);
    for (let index = 1; index < singers.length; index++) {
      const higher = voices[singers[index - 1]];
      const lower = voices[singers[index]];
      expect(lower.f0).toBeLessThan(higher.f0);
      expect(lower.formants[1]).toBeLessThan(higher.formants[1]);
      expect(lower.formants[2]).toBeLessThan(higher.formants[2]);
      expect(sum(lower)).toBeLessThan(sum(higher));
    }
    expect(voices.bass.formants[0]).toBeLessThan(voices.tenor.formants[0]);
    expect(voices.tenor.formants[0]).toBeLessThan(voices.soprano.formants[0]);
    expect(Math.abs(voices.bass.f0 / 95 - 1)).toBeLessThan(0.1);
    for (const [name, voice] of Object.entries(voices)) {
      if (name !== 'child5') {
        for (const index of [0, 1, 2]) {
          expect(voice.formants[index]).toBeLessThan(
            voices.child5.formants[index]
          );
        }
      }
    }
  });
});

describe('head preset voice sources', () => {
  it('gives the female and child presets the spectral tilt of women', () => {
    // Hanson and Chuang (1999, table X): corrected for the vowel, H1*-H2*
    // and H1*-A3* of women exceed those of men by 3.1 and 9.6 dB (Klatt and
    // Klatt 1990: H1-H2 by 5.7 dB). A raised f0 and a laxer pulse alone give
    // about 3 dB of H1*-A3*: the posterior glottal chink adds the rest.
    // The aspiration noise of the female preset fills the A3 band: without
    // it the female H1*-A3* is 9.6 dB above the male, with it 6.1 dB, as the
    // frequency-dependent losses (#36) and the flow-driven noise (#35) both
    // raise A3 against H1 (experiments/issue-36-preset-tilt.txt).
    const tilt = (preset) => {
      const head = presetHeadConfig(preset);
      const sums = { h1h2Corrected: 0, h1a3Corrected: 0 };
      for (const vowel of ['æ', 'ɑ', 'ʌ']) {
        const plan = planUtterance(`ˈ${vowel}ː`, { head });
        const samples = renderPlan(plan, { sampleRate: RATE });
        const segment = plan.segments.find((entry) => entry.kind === 'vowel');
        const range = {
          start: (segment.start + segment.end) / 2 - 0.04,
          duration: 0.08,
        };
        const f0 = estimatePitch(samples, RATE, { ...range, min: 70 });
        const measures = spectralTilt(samples, RATE, {
          ...range,
          f0,
          formants: HILLENBRAND[preset][vowel],
        });
        for (const key of Object.keys(sums)) {
          sums[key] += measures[key] / 3;
        }
      }
      return sums;
    };
    const male = tilt('male');
    for (const preset of ['female', 'child']) {
      const voice = tilt(preset);
      const h1h2 = voice.h1h2Corrected - male.h1h2Corrected;
      const h1a3 = voice.h1a3Corrected - male.h1a3Corrected;
      expect(h1h2).toBeGreaterThan(2);
      expect(h1h2).toBeLessThan(7);
      expect(h1a3).toBeGreaterThan(5.5);
      expect(h1a3).toBeLessThan(14);
    }
  });
});
