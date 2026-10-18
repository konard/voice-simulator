/**
 * Male, female and child randomization presets: the rendered voices must
 * land in the f0 and formant ranges of their speaker group.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
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
    expect(HEAD_PRESET_NAMES).toEqual(['any', 'male', 'female', 'child']);
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
      expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.16);
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
