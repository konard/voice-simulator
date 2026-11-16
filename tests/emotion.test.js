/**
 * Emotions and attitudes (issue 55): what `[angry]`, `[sad]`, … and
 * `<vs:emotion arousal="…">` change against plain speech, the separation
 * of the presets, intensity, composition with other modes, and the
 * statistics of the listening test.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  EMOTION_PRESETS,
  analyzeVoice,
  emotionChanges,
  levelDb,
  prepareUtterance,
  pulseF0,
  synthesize,
} from '../src/index.js';
import { planUtterance } from '../src/articulation/plan.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { composeMode, createMode, emotionOf } from '../src/markup/modes.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { binomialTailP } from '../scripts/listening-test.mjs';

const TEXT = 'The train leaves at seven.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const SSML = (attributes) =>
  '<speak xmlns:vs="urn:voice-simulator:markup:1">' +
  `<vs:emotion ${attributes}>${TEXT}</vs:emotion></speak>`;

const near = (value, target, tolerance) => {
  const ok = Math.abs(value - target) <= tolerance;
  if (!ok) {
    console.error(`expected ${value} to be ${target} ± ${tolerance}`);
  }
  expect(ok).toBe(true);
};
const semitones = (f0, reference) => 12 * Math.log2(f0 / reference);

const vowelsOf = (plan) =>
  plan.segments.filter((segment) => segment.kind === 'vowel');

const cache = new Map();

/** Render once; voice features, level and durations. */
function measure(input) {
  if (!cache.has(input)) {
    const result = synthesize(input, BASE);
    const { samples, sampleRate, plan } = result;
    let stressed = 0;
    for (const vowel of vowelsOf(plan)) {
      stressed += vowel.token.stress === 1 ? vowel.duration : 0;
    }
    cache.set(input, {
      result,
      voice: analyzeVoice(samples, sampleRate),
      level: levelDb(samples, 0, samples.length),
      duration: plan.duration,
      stressed,
    });
  }
  return cache.get(input);
}

const plain = () => measure(TEXT);
const tagged = (tag) => {
  const name = tag.split(' ')[0];
  return measure(`[${tag}]${TEXT}[/${name}]`);
};

/** The changes of one rendering against plain speech. */
function against(found) {
  const base = plain();
  return {
    f0: semitones(found.voice.f0, base.voice.f0),
    range: found.voice.f0Range / base.voice.f0Range,
    duration: found.duration / base.duration,
    stressed: found.stressed / base.stressed,
    h1h2: found.voice.h1h2 - base.voice.h1h2,
    level: found.level - base.level,
  };
}

/** The pitch shift of the effort alone: `[effort e]` against plain. */
const effortShift = (effort) => against(tagged(`effort ${effort}`)).f0;

/** F2 (Hz) of the planned tract at the middle of the stressed vowel. */
function stressedF2(ipa, emotion) {
  const modes = emotion
    ? [
        {
          from: 0,
          to: 1,
          mode: composeMode(createMode(), {
            emotion: emotionOf({ name: emotion }),
          }),
        },
      ]
    : [];
  const plan = planUtterance(ipa, { head: DEFAULT_HEAD, modes });
  const vowel = vowelsOf(plan).find((segment) => segment.token.stress === 1);
  const state = sampleState(plan, (vowel.start + vowel.end) / 2);
  const shape = tractShape(state, DEFAULT_HEAD);
  return tubeFormants(shape.areas, shape.length, { count: 3 })[1];
}

describe('emotion presets', () => {
  it('lists the presets with their sources', () => {
    expect(Object.keys(EMOTION_PRESETS)).toEqual([
      'neutral',
      'angry',
      'happy',
      'sad',
      'afraid',
      'bored',
      'surprised',
      'disgusted',
      'tender',
      'sarcastic',
      'confident',
      'hesitant',
    ]);
    const verified = Object.entries(EMOTION_PRESETS)
      .filter(([, row]) => row.verified)
      .map(([name]) => name);
    expect(verified).toEqual([
      'neutral',
      'angry',
      'happy',
      'sad',
      'afraid',
      'bored',
    ]);
    expect(EMOTION_PRESETS.angry.source).toBe('Burkhardt & Sendlmeier 2000');
  });

  it('scales the changes by the intensity', () => {
    const half = emotionChanges({ name: 'angry', intensity: 0.5 });
    near(half.pitch, 3.5, 1e-9);
    near(half.range, Math.sqrt(3), 1e-6);
    near(half.effort, 0.625, 1e-9);
    near(half.phonation.tension, 0.25, 1e-9);
    near(half.glide, -15, 1e-9);
    expect(emotionChanges('sad').pauses).toBe(1.5);
    expect(emotionChanges({ name: 'angry', intensity: 0 }).pitch).toBe(0);
  });

  it('places the dimensions after Schröder et al. (2001)', () => {
    const changes = emotionChanges({ arousal: 1 });
    near(changes.pitch, 12 * Math.log2(1.32), 1e-6);
    near(changes.range, 2.15, 1e-9);
    near(changes.effort, 0.75, 1e-9);
    near(changes.rate, 1.2, 1e-9);
    near(changes.pauses, 0.7, 1e-9);
    const low = emotionChanges({ arousal: -1, valence: 0.5, dominance: -1 });
    near(low.range, 0.3, 1e-9);
    near(low.smile, 0.5, 1e-9);
    near(low.glide, 15, 1e-9);
    near(low.phonation.tension, -0.4, 1e-9);
    near(low.phonation.breathy, 0.4, 1e-9);
    // A named preset keeps its row.
    expect(emotionChanges({ name: 'happy', arousal: -1 }).pitch).toBe(7);
  });
});

describe('emotions in the voice', () => {
  it('angry: high, wide, fast and pressed', () => {
    const angry = against(tagged('angry'));
    near(angry.f0, 7 + effortShift(0.75), 1.5);
    expect(angry.range).toBeGreaterThanOrEqual(2);
    expect(angry.duration).toBeGreaterThanOrEqual(0.7);
    expect(angry.duration).toBeLessThanOrEqual(0.9);
    expect(angry.h1h2).toBeLessThanOrEqual(-3);
  });

  it('happy: high and wide with a smile', () => {
    const happy = against(tagged('happy'));
    expect(happy.f0).toBeGreaterThanOrEqual(6);
    expect(happy.range).toBeGreaterThanOrEqual(1.6);
    const rise = stressedF2('ˈpapa', 'happy') / stressedF2('ˈpapa') - 1;
    expect(rise).toBeGreaterThanOrEqual(0.05);
    expect(rise).toBeLessThanOrEqual(0.1);
  });

  it('sad: low, narrow, slow, breathy and soft', () => {
    const sad = against(tagged('sad'));
    near(sad.f0, -3.9, 1);
    expect(sad.range).toBeLessThanOrEqual(0.9);
    expect(sad.duration).toBeGreaterThanOrEqual(1.5);
    expect(sad.h1h2).toBeGreaterThanOrEqual(2);
    expect(sad.level).toBeLessThanOrEqual(-4);
  });

  it('afraid: very high with a final rise', () => {
    const found = tagged('afraid');
    expect(against(found).f0).toBeGreaterThanOrEqual(12);
    const { plan, samples, sampleRate } = found.result;
    const last = vowelsOf(plan).at(-1);
    const f0 = plan.channels.f0;
    const first = Math.round(last.start * plan.frameRate);
    const end = Math.round(last.end * plan.frameRate) - 1;
    expect(semitones(f0[end], f0[first])).toBeGreaterThanOrEqual(2);
    // In the sound: the last third of the vowel above its first third.
    const third = (last.end - last.start) / 3;
    const start = pulseF0(samples, sampleRate, {
      start: last.start,
      end: last.start + third,
    });
    const stop = pulseF0(samples, sampleRate, {
      start: last.end - third,
      end: last.end,
    });
    expect(semitones(stop, start)).toBeGreaterThanOrEqual(1.5);
  });

  it('bored: low, flat, with long stressed vowels', () => {
    const bored = against(tagged('bored'));
    near(bored.f0, -3.9, 1);
    expect(bored.range).toBeLessThanOrEqual(0.6);
    expect(bored.stressed).toBeGreaterThanOrEqual(1.3);
  });
});

describe('emotion separation and intensity', () => {
  it('keeps the twelve presets apart', () => {
    const vectors = Object.keys(EMOTION_PRESETS).map((name) => {
      const found = name === 'neutral' ? plain() : tagged(name);
      const change = against(found);
      return {
        name,
        vector: [change.f0, change.range, change.duration, change.h1h2 / 3],
      };
    });
    const close = [];
    for (let a = 0; a < vectors.length; a++) {
      for (let b = a + 1; b < vectors.length; b++) {
        const distance = Math.hypot(
          ...vectors[a].vector.map((value, k) => value - vectors[b].vector[k])
        );
        if (distance < 1) {
          close.push(`${vectors[a].name}/${vectors[b].name} ${distance}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it('raises the pitch with the intensity', () => {
    const f0 = ['angry 0.33', 'angry 0.67', 'angry'].map(
      (tag) => tagged(tag).voice.f0
    );
    expect(f0[0]).toBeLessThan(f0[1]);
    expect(f0[1]).toBeLessThan(f0[2]);
  });

  it('keeps plain samples at intensity 0', () => {
    const none = tagged('angry 0').result.samples;
    const base = plain().result.samples;
    expect(none.length).toBe(base.length);
    let same = true;
    for (let index = 0; index < base.length && same; index++) {
      same = none[index] === base[index];
    }
    expect(same).toBe(true);
  });
});

describe('emotion dimensions and composition', () => {
  it('follows the arousal', () => {
    const high = against(measure(SSML('arousal="1"')));
    near(high.f0, 12 * Math.log2(1.32) + effortShift(0.75), 1);
    const low = against(measure(SSML('arousal="-1"')));
    expect(low.f0).toBeLessThan(0);
    expect(low.duration).toBeGreaterThan(1);
  });

  it('keeps an inner span soft', () => {
    const { plan } = prepareUtterance('[angry][soft]x[/soft][/angry]', {
      markup: true,
      seed: 1,
    });
    const angry = plan.modes.filter((span) => span.emotion.name === 'angry');
    expect(angry.map((span) => span.effort)).toEqual([0.25]);
    expect(angry[0].rate).toBe(1.3);
  });

  it('judges 12 of 20 right with 6 choices as above chance', () => {
    expect(binomialTailP(12, 20, 1 / 6)).toBeLessThan(0.001);
    near(binomialTailP(0, 20, 1 / 6), 1, 1e-12);
    near(binomialTailP(20, 20, 0.5), 0.5 ** 20, 1e-18);
  });
});
