/**
 * Vocal effort and loudness dynamics (issue 52): what `[soft]`, `[loud]`
 * and `[shout]` change against plain speech, ramps, the headroom that keeps
 * a shout from clipping, the level convention and BS.1770 loudness.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  EFFORT_RULES,
  alphaRatio,
  analyzeVoice,
  decibelsToEffort,
  effortChanges,
  effortToSpl,
  fastEffortRamps,
  integratedLoudness,
  levelDb,
  maxModeLevel,
  normalizeLoudness,
  prepareUtterance,
  splToEffort,
  synthesize,
  synthesizeStream,
} from '../src/index.js';

const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };

const near = (value, target, tolerance) => {
  const ok = Math.abs(value - target) <= tolerance;
  if (!ok) {
    console.error(`expected ${value} to be ${target} ± ${tolerance}`);
  }
  expect(ok).toBe(true);
};
const semitones = (f0, reference) => 12 * Math.log2(f0 / reference);

/** Summed durations (s) of the vowels and of the consonants of a plan. */
function durations(plan) {
  let vowels = 0;
  let consonants = 0;
  for (const segment of plan.segments) {
    if (segment.kind === 'vowel') {
      vowels += segment.duration;
    } else if (segment.token && segment.kind !== 'pause') {
      consonants += segment.duration;
    }
  }
  return { vowels, consonants };
}

const cache = new Map();

/** Render once and measure level, alpha ratio, voice features, durations. */
function measure(input, options = {}) {
  const key = JSON.stringify([input, options]);
  if (!cache.has(key)) {
    const result = synthesize(input, { ...BASE, ...options });
    const { samples, sampleRate } = result;
    cache.set(key, {
      result,
      level: levelDb(samples, 0, samples.length),
      alpha: alphaRatio(samples, sampleRate, 0, samples.length),
      voice: analyzeVoice(samples, sampleRate),
      ...durations(result.plan),
    });
  }
  return cache.get(key);
}

const plain = () => measure(TEXT);
const tagged = (tag) => measure(`[${tag}]${TEXT}[/${tag}]`);
const ipa = (text) => measure(text, { ipa: true, markup: false });

describe('vocal effort', () => {
  it('changes the level by the effort', () => {
    near(tagged('soft').level - plain().level, -10, 1.5);
    near(tagged('loud').level - plain().level, 10, 1.5);
    near(tagged('shout').level - plain().level, 20, 2);
  });

  it('raises the pitch with effort', () => {
    const f0 = plain().voice.f0;
    near(semitones(tagged('soft').voice.f0, f0), -4, 1);
    near(semitones(tagged('loud').voice.f0, f0), 6, 1);
    near(semitones(tagged('shout').voice.f0, f0), 10.5, 1.5);
  });

  it('flattens the spectrum with effort', () => {
    near(tagged('soft').alpha - plain().alpha, -2, 1);
    near(tagged('loud').alpha - plain().alpha, 2, 1);
    near(tagged('shout').alpha - plain().alpha, 4, 1.5);
    expect(tagged('shout').voice.h1h2 <= plain().voice.h1h2 - 3).toBe(true);
  });

  it('raises the first formant', () => {
    const f1 = ipa('ˈa').voice.formants[0];
    near(ipa('{f ˈa f}').voice.formants[0] - f1, 35, 15);
    near(ipa('{ff ˈa ff}').voice.formants[0] - f1, 70, 25);
  });

  it('lengthens vowels, not consonants', () => {
    near(tagged('loud').vowels / plain().vowels, 1.1, 0.03);
    near(tagged('shout').vowels / plain().vowels, 1.3, 0.05);
    for (const tag of ['soft', 'loud', 'shout']) {
      near(tagged(tag).consonants / plain().consonants, 1, 0.02);
    }
  });

  it('keeps a plain gain plain', () => {
    const quieter = measure(
      `<speak><prosody vs:gain="-6dB">${TEXT}</prosody></speak>`
    );
    near(quieter.level - plain().level, -6, 0.5);
    expect(Math.abs(quieter.alpha - plain().alpha) < 0.3).toBe(true);
  });

  it('ramps a crescendo', () => {
    const { result } = measure('[crescendo]la la la la la la[/crescendo]', {
      headroom: undefined,
    });
    const levels = result.plan.segments
      .filter((segment) => segment.kind === 'vowel')
      .map((segment) =>
        levelDb(
          result.samples,
          Math.round(segment.start * result.sampleRate),
          Math.round(segment.end * result.sampleRate)
        )
      );
    expect(levels.length).toBe(6);
    for (let index = 1; index < levels.length; index++) {
      expect(levels[index] > levels[index - 1]).toBe(true);
    }
    near(levels.at(-1) - levels[0], 10, 2);
    expect(result.levelOffsetDb).toBe(-10);
  });

  it('does not clip', () => {
    const { result } = measure(`[shout]${TEXT}[/shout]`, {
      headroom: undefined,
    });
    const loud = result.samples.filter((sample) => Math.abs(sample) > 0.9);
    expect(loud.length < result.samples.length * 0.001).toBe(true);
    expect(result.levelOffsetDb).toBe(-20);
    expect(plain().result.levelOffsetDb).toBe(-20);
  });

  it('reads the same from IPA', () => {
    const fromIpa = prepareUtterance('{ff ˈpliz ff}', {
      tier: 'medium',
      ipa: true,
    });
    const fromText = prepareUtterance('[shout]please[/shout]', {
      tier: 'medium',
      markup: true,
    });
    expect(fromText.ipa).toBe('{ff ˈpliz ff}');
    expect(Array.from(fromIpa.plan.channels.effort)).toEqual(
      Array.from(fromText.plan.channels.effort)
    );
    near(Math.max(...fromText.plan.channels.effort), 20, 1e-5);
  });

  it('warns about a fast effort ramp', () => {
    const { warnings } = prepareUtterance('[crescendo]I[/crescendo] am.', {
      tier: 'low',
      markup: true,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0].position).toBe('[crescendo]'.length);
    expect(warnings[0].message).toMatch(/faster than 40 dB\/s/);
    const slow = prepareUtterance('[crescendo]la la la la la la[/crescendo]', {
      tier: 'low',
      markup: true,
    });
    expect(slow.warnings).toEqual([]);
    expect(
      fastEffortRamps([{ start: 0, end: 0.1, effort: 0.5, effortEnd: 0.75 }])
    ).toEqual([{ start: 0, end: 0.1, rate: 100 }]);
  });
});

describe('effort rules and level convention', () => {
  it('lists the rules of step 1', () => {
    const loud = effortChanges(10, { pitch: 120 });
    near(loud.level, 10, 1e-9);
    near(loud.lungPressure, 2 ** (10 / 9), 1e-9);
    near(loud.pitch, 12 * Math.log2(170 / 120), 1e-9);
    near(loud.f1, 35, 1e-9);
    near(loud.tilt, 2, 1e-9);
    near(loud.vowelDuration, 1.1, 1e-9);
    near(loud.consonantDuration, 1, 1e-9);
    near(loud.noise, 5, 1e-9);
    near(effortChanges(20).vowelDuration, 1.3, 1e-9);
    // The pitch shift is clamped to -4..+12 semitones.
    near(effortChanges(-20, { pitch: 120 }).pitch, -4, 1e-9);
    near(effortChanges(20, { pitch: 60 }).pitch, 12, 1e-9);
    for (const rule of Object.values(EFFORT_RULES)) {
      expect(typeof rule.source).toBe('string');
    }
  });

  it('maps effort to sound pressure level', () => {
    expect(effortToSpl(0.5)).toBe(60);
    expect(effortToSpl(1)).toBe(80);
    expect(effortToSpl(0)).toBe(40);
    expect(splToEffort(70)).toBe(0.75);
    expect(decibelsToEffort(-10)).toBe(0.25);
    for (const effort of [0, 0.3, 0.5, 0.9]) {
      near(splToEffort(effortToSpl(effort)), effort, 1e-12);
    }
  });

  it('needs headroom for the loudest span', () => {
    const span = (effort, effortEnd = effort, gain = 0) => ({
      start: 0,
      end: 1,
      effort,
      effortEnd,
      gain,
    });
    expect(maxModeLevel([span(0.5)])).toBe(0);
    expect(maxModeLevel([span(0.25)])).toBe(0);
    expect(maxModeLevel([span(0.5, 0.75)])).toBe(10);
    expect(maxModeLevel([span(1, 1, -6), span(0.75, 0.75, 6)])).toBe(16);
  });
});

describe('loudness', () => {
  const sine = (sampleRate, seconds, amplitude = 1) =>
    Float32Array.from(
      { length: Math.round(sampleRate * seconds) },
      (_, index) =>
        amplitude * Math.sin((2 * Math.PI * 997 * index) / sampleRate)
    );

  it('measures loudness', () => {
    for (const sampleRate of [44100, 48000]) {
      near(integratedLoudness(sine(sampleRate, 3), sampleRate), -3.01, 0.1);
    }
    near(integratedLoudness(sine(48000, 3, 0.1), 48000), -23.01, 0.1);
    const normalized = normalizeLoudness(sine(48000, 3, 0.1), 48000, -30);
    near(integratedLoudness(normalized.samples, 48000), -30, 0.05);
    const result = synthesize(TEXT, { tier: 'low', loudnessTarget: -23 });
    near(integratedLoudness(result.samples, result.sampleRate), -23, 0.5);
    near(result.loudness, -23, 0.5);
  });

  it('keeps the peak below 0.98 when it normalizes', () => {
    const { samples, gainDb } = normalizeLoudness(sine(48000, 1), 48000, 0);
    expect(Math.max(...samples.map(Math.abs)) <= 0.98).toBe(true);
    expect(gainDb < 0).toBe(true);
  });

  it('is not available for streams', async () => {
    const stream = synthesizeStream(TEXT, { tier: 'low', loudnessTarget: -23 });
    let error = null;
    try {
      await stream.next();
    } catch (caught) {
      error = caught;
    }
    expect(error?.message ?? '').toMatch(/loudnessTarget/);
  });
});
