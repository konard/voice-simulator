/**
 * Source-tract interaction (issue 34): the interactive glottal flow of
 * Titze (2008), the subglottal line and the effects of the coupling on
 * static vowels at 120 Hz (tests/helpers/interaction.js; the numbers are
 * those of experiments/issue-11-interaction.txt).
 */

import { describe, it, expect } from 'test-anywhere';
import {
  GLOTTAL_PRESSURE_COEFFICIENT,
  interactiveFlow,
} from '../src/acoustics/folds.js';
import { AIR_DENSITY, SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { rms } from '../src/acoustics/analysis.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { planUtterance } from '../src/articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { synthesize } from '../src/synthesize.js';
import {
  firstFormant,
  flowRipple,
  pulseSkew,
  runVowel,
  subglottalResonances,
  tail,
  tractResonance,
} from './helpers/interaction.js';

const K = GLOTTAL_PRESSURE_COEFFICIENT;
const RHO = AIR_DENSITY;
const C = SPEED_OF_SOUND;

describe('interactive glottal flow', () => {
  it('solves the flow equation', () => {
    const bernoulli = 0.1 * Math.sqrt((4 * 4000) / (K * RHO));
    expect(
      Math.abs(interactiveFlow(0.1, Infinity, Infinity, 4000) - bernoulli)
    ).toBeLessThan(1e-9);
    const u = interactiveFlow(0.1, 3, 3, 4000);
    expect(u).toBeLessThan(bernoulli);
    expect(u).toBeGreaterThan(0);
    // The transglottal drop plus the drops on both sides take 2D.
    const balance =
      (K * RHO * u * u) / (2 * 0.1 * 0.1) + RHO * C * u * (1 / 3 + 1 / 3);
    expect(Math.abs(balance - 2 * 4000) / (2 * 4000)).toBeLessThan(1e-6);
    expect(interactiveFlow(0.1, 3, 3, -4000)).toBe(-u);
    expect(interactiveFlow(0, 3, 3, 4000)).toBe(0);
  });

  it('reports the load of a uniform tube', () => {
    // Rigid walls and no piriform branch: nothing returns before the
    // waves have been to the lips and back (2 * 44 steps).
    const sections = 44;
    const guide = new Waveguide({
      sections,
      noseSections: 12,
      head: {},
      piriform: false,
      walls: false,
    });
    guide.setShape(new Float64Array(sections).fill(3), 0, 20);
    guide.setGlottalReflection(1);
    let integral = 0;
    let early = 0;
    for (let step = 0; step < 2 * sections + 8; step++) {
      const load = guide.glottalLoad();
      expect(load.area).toBe(3);
      integral += load.incident;
      if (step < 2 * sections) {
        early = Math.max(early, Math.abs(integral));
      }
      guide.step(step === 0 ? 1 : 0, 1, 0, 0);
    }
    expect(early).toBe(0);
    // The open lips send the step back with the opposite sign.
    expect(integral).toBeLessThan(-0.05);
  });

  it('resonates like a windpipe', () => {
    const head = normalizeHeadConfig(DEFAULT_HEAD);
    const peaks = subglottalResonances(head, 16.5 / (44 * C));
    const ranges = [
      [550, 700],
      [1300, 1650],
      [2000, 2400],
    ];
    expect(peaks.length).toBe(3);
    peaks.forEach(({ frequency }, index) => {
      expect(frequency).toBeGreaterThan(ranges[index][0]);
      expect(frequency).toBeLessThan(ranges[index][1]);
    });
  });
});

describe('source-tract interaction on a static vowel', () => {
  const plain = runVowel('ˈɑː');
  const coupled = runVowel('ˈɑː', { interaction: true });

  it('skews the pulse to the right', () => {
    const before = pulseSkew(tail(plain.flow, plain.rate));
    const after = pulseSkew(tail(coupled.flow, coupled.rate));
    // 0.526 and 0.659
    expect(after - before).toBeGreaterThan(0.05);
  });

  it('leaves a ripple at the first formant', () => {
    const flow = tail(coupled.flow, coupled.rate);
    const ripple = flowRipple(flow, coupled.rate);
    // The ripple rings at the first resonance of the tract as the open
    // glottis loads it: 1175 Hz, where the tract with an absorbing
    // glottal end has its F1 (1208 Hz), while the closed tract's F1 is
    // 797 Hz (experiments/issue-34-open-f1.txt). Without interaction the
    // residual has no such peak.
    const open = tractResonance('ˈɑː', 0).frequency;
    expect(Math.abs(ripple.frequency - open) / open).toBeLessThan(0.2);
    expect(ripple.size).toBeGreaterThan(0.01);
    const smooth = flowRipple(tail(plain.flow, plain.rate), plain.rate, {
      part: 'rising',
    });
    const rising = flowRipple(flow, coupled.rate, { part: 'rising' });
    // 0.58 % and 1.84 % of the peak flow
    expect(rising.size).toBeGreaterThan(2 * smooth.size);
  });

  it('damps the first formant more while the glottis is open', () => {
    const bandwidth = (adduction) => {
      const run = runVowel('ˈɑː', { interaction: true, adduction });
      return firstFormant(tail(run.output, run.rate), run.rate).bandwidth;
    };
    // 168 and 107 Hz
    expect(bandwidth(0.3)).toBeGreaterThan(1.2 * bandwidth(0.8));
  });
});

describe('source-tract interaction in the renderer', () => {
  it('stays stable in 3D', () => {
    const render = (tier) =>
      synthesize('ˈama', {
        ipa: true,
        source: 'folds',
        interaction: true,
        tier,
      });
    const high = render('high');
    const medium = render('medium');
    expect(high.samples.every(Number.isFinite)).toBe(true);
    const level = (samples) => rms(samples, 0, samples.length);
    const difference =
      20 * Math.log10(level(high.samples) / level(medium.samples));
    expect(Math.abs(difference)).toBeLessThan(6);
  });

  it('rejects interaction with the LF source', () => {
    const plan = planUtterance('ˈɑː');
    let message = '';
    try {
      new VoiceRenderer(plan, { source: 'lf', interaction: true });
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe("Interaction needs source: 'folds'");
  });
});
