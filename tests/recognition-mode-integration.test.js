/** Pause sounds and mode replay integration. Unlicense. */
import { describe, it, expect } from 'test-anywhere';
import {
  recognizeModes,
  toPlanModes,
  planUtterance,
  synthesize,
  prepareUtterance,
} from '../src/index.js';
import { voiceBaseline } from '../src/recognition/mode-baseline.js';
import { effortRamps } from '../src/recognition/mode-spans.js';
import {
  phraseSummary,
  measureWords,
} from '../src/recognition/mode-features.js';
import { HEAD } from './helpers/recognition-modes.js';

describe('speech-mode integration', () => {
  it('preserves an existing sound token without duplicating its detection', () => {
    const audio = synthesize('⸨inhale⸩ a', {
      ipa: true,
      head: HEAD,
      tier: 'minimal',
      seed: 1,
      engine: 'js',
    });
    const heard = recognizeModes(audio.samples, audio.sampleRate, {
      words: audio.timeline.words,
      ipa: '⸨inhale⸩ a',
    });
    expect(heard.ipa).toBe('⸨inhale⸩ a');
    expect(heard.modes.some((s) => s.sound === 'inhale')).toBe(true);
  });
  it('replays unlabelled emotion spans through the high-level synthesizer', () => {
    const modes = toPlanModes([
      { from: 0, to: 3, emotion: { name: 'angry', intensity: 1 } },
    ]);
    const result = prepareUtterance('{W a a a W}', {
      ipa: true,
      head: HEAD,
      tier: 'minimal',
      modes,
    });
    expect(result.modes[0].mode.emotion.name).toBe('angry');
    expect(result.plan.modes.some((s) => s.emotion.name === 'angry')).toBe(
      true
    );
    expect(result.plan.modes.some((s) => s.phonation.whisper > 0)).toBe(false);
  });
  it('measures phrase pitch range across words with constant vowel pitch', () => {
    const words = [100, 200].map((pitch) => ({
      vowels: 1,
      pitches: [pitch, pitch, pitch],
      pitchSpan: 0,
      f1: null,
    }));
    expect(phraseSummary(words).pitchSpan).toBe(12);
  });
  it('keeps effort ramps continuous through overlapping tempo boundaries', () => {
    const modes = toPlanModes([
      { from: 0, to: 4, effort: 0.5, effortEnd: 1 },
      { from: 2, to: 4, rate: 1.3 },
    ]);
    expect(modes.map((s) => [s.mode.effort, s.mode.effortEnd])).toEqual([
      [0.5, 0.75],
      [0.75, 1],
    ]);
  });
  it('does not fit effort ramps in phrases that abstain', () => {
    const words = Array.from({ length: 4 }, (_, i) => ({
      start: i,
      end: i + 1,
    }));
    const labels = words.map((_, i) => ({
      E: i * 10,
      pitchEffort: i * 10,
      quality: null,
      abstain: true,
    }));
    expect(effortRamps(words, labels, [])).toEqual([]);
  });
  for (const sound of ['inhale', 'laugh', 'filler']) {
    it(`recognizes ${sound} from pause audio and writes its IPA token`, () => {
      const audio = synthesize(`⸨${sound}⸩`, {
        ipa: true,
        head: HEAD,
        tier: 'minimal',
        seed: 1,
        engine: 'js',
      });
      const result = recognizeModes(audio.samples, audio.sampleRate, {
        words: [],
      });
      expect(result.modes.some((span) => span.sound === sound)).toBe(true);
      expect(result.ipa.includes(`⸨${sound}⸩`)).toBe(true);
      expect(toPlanModes(result.modes)).toEqual([]);
      expect(planUtterance(result.ipa, { head: HEAD }).sounds[0].name).toBe(
        sound
      );
    });
  }
  it('combines simultaneous partial fields before the planner selects spans', () => {
    const modes = toPlanModes([
      { from: 0, to: 3, effort: 0.75 },
      { from: 1, to: 3, rate: 1.3 },
      { from: 2, to: 4, emotion: { arousal: 0.4 }, notation: null },
      { from: 2, to: 4, phonation: { breathy: 0.33 } },
    ]);
    expect(modes).toEqual([
      { from: 0, to: 1, mode: { effort: 0.75, effortEnd: 0.75 } },
      { from: 1, to: 2, mode: { effort: 0.75, effortEnd: 0.75, rate: 1.3 } },
      {
        from: 2,
        to: 3,
        mode: {
          effort: 0.75,
          effortEnd: 0.75,
          rate: 1.3,
          emotion: { arousal: 0.4, realized: true },
          phonation: { breathy: 0.33 },
        },
      },
      {
        from: 3,
        to: 4,
        mode: {
          emotion: { arousal: 0.4, realized: true },
          phonation: { breathy: 0.33 },
        },
      },
    ]);
    const plan = planUtterance('wʌn tu θri fɔɹ', { head: HEAD, modes });
    const combined = plan.modes.find(
      (s) => s.effort === 0.75 && s.emotion.arousal === 0.4
    );
    expect(combined.phonation.breathy).toBe(0.33);
    expect(combined.rate).toBe(1.3);
    expect(combined.emotion.realized).toBe(true);
    expect(combined.emotionPitch).toBe(undefined);
  });
  it('snapshots a mutable caller head before caching reference features', () => {
    const head = { ...HEAD };
    const baseline = voiceBaseline({ head }, 22050, 'en');
    head.pitch = 200;
    expect(baseline.head.pitch).toBe(HEAD.pitch);
    expect(voiceBaseline({ head: HEAD }, 22050, 'en')).toBe(baseline);
  });
  it('rejects invalid audio and word intervals before analysis', () => {
    for (const run of [
      () => recognizeModes([NaN], 8000, { words: [] }),
      () => recognizeModes([0], 7999, { words: [] }),
      () =>
        recognizeModes([0], 8000, { words: [{ ipa: 'a', start: 0, end: 1 }] }),
    ]) {
      let failed = false;
      try {
        run();
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    }
  });
});

describe('recognized activation replay', () => {
  it('retains a phrase activation observation across gaps in physical labels', () => {
    const observations = [
      { from: 0, to: 3, emotion: { arousal: 0.7 }, notation: null },
      { from: 0, to: 2, effort: 0.75 },
    ];
    const modes = toPlanModes(observations);
    expect(observations[0].emotion.realized).toBe(undefined);
    const plan = planUtterance('wʌn tu θri', { head: HEAD, modes });
    expect(
      plan.modes.some(
        (s) => s.emotion.arousal === 0.7 && s.emotion.realized && s.rate === 1
      )
    ).toBe(true);
    expect(
      plan.modes.some((s) => s.emotion.arousal === 0.7 && !s.emotion.realized)
    ).toBe(false);
    const standalone = planUtterance('wʌn tu θri', {
      head: HEAD,
      modes: toPlanModes([observations[0]]),
    });
    expect(standalone.modes.some((s) => s.emotionPitch > 0)).toBe(true);
  });
});

describe('syllabic mode features', () => {
  it('counts syllabic consonants with estimated and supplied phone timing', () => {
    const samples = Float32Array.from({ length: 3200 }, (_, i) =>
      Math.sin((2 * Math.PI * 120 * i) / 8000)
    );
    const word = { ipa: 'ɻ̩', start: 0, end: 0.4 };
    for (const phonemes of [undefined, [word]]) {
      const [features] = measureWords(samples, 8000, {
        words: [word],
        phonemes,
      });
      expect(features.vowels).toBe(1);
      expect(features.pitch).toBeGreaterThan(100);
    }
  });
});

describe('mode baseline sample rates', () => {
  it('uses matching waveguide tiers above the minimal sample rate', () => {
    for (const [sampleRate, tier] of [
      [32000, 'low'],
      [48000, 'medium'],
    ]) {
      const baseline = voiceBaseline('male', sampleRate, 'en');
      expect(baseline.options.tier).toBe(tier);
    }
  });
});
