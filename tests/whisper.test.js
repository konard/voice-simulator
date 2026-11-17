/**
 * Whisper (issue 53): `[whisper]`, `{W … W}` and the voiceless vowels give
 * a noise source at a half-open glottis and no fold vibration, quieter
 * and longer speech with a higher spectrum, and keep the contrast of the
 * voiced and voiceless consonants. Formants (3D, tier high) and the CLI at
 * its default tier are in tests/heavy/quality-whisper.test.js.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { runCli } from '../bin/voice-simulator.js';
import {
  analyzeVoice,
  centreOfGravity,
  decodeAudio,
  energyRatio,
  frameAperiodicities,
  levelDb,
  prepareUtterance,
  synthesize,
  textToIpa,
  voicedShare,
} from '../src/index.js';
import {
  GLOTTAL_REFLECTION,
  Glottis,
  glottalReflection,
} from '../src/acoustics/glottis.js';
import {
  WHISPER_PITCH_LIMIT,
  WHISPER_STOP_DRIVE,
  whisperArea,
  whisperDrive,
  whisperPitchGain,
  whisperReflection,
  whisperTransient,
} from '../src/acoustics/whisper.js';
import { WHISPER_DURATION, planWhispers } from '../src/articulation/whisper.js';
import { FramePlanner } from '../src/engine/rust-renderer.js';
import { itUnless } from './helpers/skip.js';

const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const IPA = { ipa: true, markup: false };

// Bun on macOS takes Math.sin and Math.exp from the system libm, whose last
// bits differ (see tests/narrow-band.test.js).
const appleLibm =
  typeof process !== 'undefined' &&
  process.versions?.bun &&
  process.platform === 'darwin'
    ? "JavaScriptCore uses the macOS libm, not V8's Math"
    : null;

const cache = new Map();

/** Render once (cached) and measure level and voice features. */
function measure(input, options = {}) {
  const key = JSON.stringify([input, options]);
  if (!cache.has(key)) {
    const result = synthesize(input, { ...BASE, ...options });
    const { samples, sampleRate } = result;
    cache.set(key, {
      result,
      level: levelDb(samples, 0, samples.length),
      voiced: voicedShare(samples, sampleRate),
      hnr: analyzeVoice(samples, sampleRate).hnr,
    });
  }
  return cache.get(key);
}

const plain = () => measure(TEXT);
const whisper = () => measure(`[whisper]${TEXT}[/whisper]`);
const at = (result, time) => Math.round(time * result.sampleRate);
const firstConsonant = (result) =>
  result.plan.segments.find((s) => s.kind === 'consonant' && s.token);
const firstVowel = (result) =>
  result.plan.segments.find((s) => s.kind === 'vowel');

const peakDb = (samples, from, to) => {
  let peak = 0;
  for (let index = from; index < to; index++) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return 20 * Math.log10(peak);
};

/**
 * Peak (dB) of the burst of the first consonant: the 15 ms from the
 * acoustic release, the first millisecond after the quietest one of the
 * closure that comes within 50 dB of the peak of the whole sound. The
 * plan's closure ends when the lips are open, some 15 ms after the release
 * (experiments/issue-53-contrasts.mjs).
 */
function burstPeak(result) {
  const { samples } = result;
  const closure = firstConsonant(result);
  const ms = at(result, 0.001);
  const top = peakDb(samples, 0, samples.length);
  let quietest = Infinity;
  let release = 0;
  for (
    let i = at(result, closure.start);
    i < at(result, closure.end);
    i += ms
  ) {
    const level = peakDb(samples, i, i + ms);
    if (level < quietest) {
      quietest = level;
      release = i;
    }
  }
  while (peakDb(samples, release, release + ms) < top - 50) {
    release += ms;
  }
  return peakDb(samples, release, release + at(result, 0.015));
}

/** Duration (s) and level (dB) of the first consonant. */
function consonant(result) {
  const segment = firstConsonant(result);
  const from = at(result, segment.start);
  const to = at(result, segment.end);
  return {
    duration: segment.end - segment.start,
    level: levelDb(result.samples, from, to),
  };
}

describe('whisper', () => {
  it('has no voiced frames', () => {
    expect(plain().voiced > 0.8).toBe(true);
    expect(whisper().voiced < 0.05).toBe(true);
  });

  it('is aperiodic noise', () => {
    const { samples, sampleRate } = whisper().result;
    const values = frameAperiodicities(samples, sampleRate);
    const noisy = values.filter((value) => value > 0.4).length;
    expect(values.length > 50).toBe(true);
    expect(noisy / values.length >= 0.95).toBe(true);
    expect(whisper().hnr < 5).toBe(true);
  });

  it('is about 25 dB quieter than the voice, and follows the effort', () => {
    const level = whisper().level;
    const soft = measure(`[whisper][soft]${TEXT}[/soft][/whisper]`).level;
    const loud = measure(`[whisper][loud]${TEXT}[/loud][/whisper]`).level;
    expect(Math.abs(level - plain().level + 25) <= 4).toBe(true);
    expect(Math.abs(soft - level + 5) <= 2).toBe(true);
    expect(Math.abs(loud - level - 5) <= 2).toBe(true);
  });

  it('has a higher spectrum', () => {
    const energy = (input) => {
      const { samples, sampleRate } = measure(input).result;
      return {
        ratio: energyRatio(samples, sampleRate),
        centre: centreOfGravity(samples, sampleRate),
      };
    };
    const voice = energy(TEXT);
    const whispered = energy(`[whisper]${TEXT}[/whisper]`);
    expect(whispered.ratio - voice.ratio >= 6).toBe(true);
    expect(whispered.centre >= 1.6 * voice.centre).toBe(true);
  });

  it('is 1.3 times as long', () => {
    const ratio = whisper().result.plan.duration / plain().result.plan.duration;
    expect(Math.abs(ratio - (1 + WHISPER_DURATION)) <= 0.05).toBe(true);
  });

  it('keeps the contrast of [p] and [b]', () => {
    const p = measure('{W ˈapa W}', IPA).result;
    const b = measure('{W ˈaba W}', IPA).result;
    const closure = (result) => consonant(result).duration;
    expect(closure(p) - closure(b) >= 0.02).toBe(true);
    expect(burstPeak(p) - burstPeak(b) >= 3).toBe(true);
  });

  it('keeps the contrast of [s] and [z]', () => {
    const s = consonant(measure('{W ˈasa W}', IPA).result);
    const z = consonant(measure('{W ˈaza W}', IPA).result);
    expect(s.duration - z.duration >= 0.02).toBe(true);
    expect(s.level - z.level >= 3).toBe(true);
  });

  it('gives voiceless vowels the whisper source', () => {
    // Without headroom: the level is against full scale.
    const { result, voiced } = measure('ˈhḁ', { ...IPA, headroom: 0 });
    const vowel = firstVowel(result);
    const from = at(result, vowel.start);
    const to = at(result, vowel.end);
    expect(levelDb(result.samples, from, to) > -45).toBe(true);
    expect(voiced).toBe(0);
  });

  it('makes a whispery voice noisy but voiced', () => {
    const whispery = measure('{Ṿ ˈama Ṿ}', IPA);
    const modal = measure('ˈama', IPA);
    expect(whispery.voiced > 0.5).toBe(true);
    expect(modal.hnr - whispery.hnr >= 4).toBe(true);
    expect(whispery.hnr < 10).toBe(true);
  });

  // Node.js, Bun and Deno render the same samples: the noise comes from
  // src/random.js alone.
  itUnless(appleLibm)('renders the same samples on every runtime', () => {
    const { samples } = synthesize('[whisper]Hi.[/whisper]', {
      tier: 'minimal',
      seed: 1,
      markup: true,
    });
    const bytes = new Uint8Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '38cb62ceafdc4a6ab20f94c9b288bdf782a3b3aa539cb521ceef7f822490387a'
    );
  });

  it('is rendered by the CLI', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'whisper-'));
    const file = path.join(folder, 'w.wav');
    try {
      const code = await runCli(
        [
          'say',
          '--markup',
          '[whisper]Hello.[/whisper]',
          '--tier',
          'medium',
          '--out',
          file,
        ],
        { stdout: () => {}, stderr: () => {} }
      );
      expect(code).toBe(0);
      const { samples, sampleRate } = decodeAudio(readFileSync(file));
      expect(voicedShare(samples, sampleRate) < 0.05).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('whisper in the plan', () => {
  const channel = (input, options) =>
    Array.from(
      prepareUtterance(input, { seed: 1, ...options }).plan.channels.whisper
    );
  const middle = (
    plan,
    values,
    vowel = plan.segments.find((s) => s.kind === 'vowel')
  ) => values[Math.round(((vowel.start + vowel.end) / 2) * plan.frameRate)];

  it('is the same for every way to write it', () => {
    const tagged = channel('[whisper]ma[/whisper]', { markup: true });
    const { ipa } = textToIpa('ma');
    expect(channel(`{W ${ipa} W}`, IPA)).toEqual(tagged);
    for (const ssml of [
      '<speak><vs:effort level="whisper">ma</vs:effort></speak>',
      '<speak><vs:phonation name="whisper">ma</vs:phonation></speak>',
    ]) {
      expect(channel(ssml, { markup: true })).toEqual(tagged);
    }
    expect(Math.max(...tagged)).toBe(1);
  });

  it('whispers voiceless and dotted vowels', () => {
    for (const text of ['ˈhḁ', 'ˈmạ', 'ˈl̥a']) {
      const { plan } = prepareUtterance(text, { seed: 1, ...IPA });
      expect(planWhispers(plan)).toBe(true);
    }
    const { plan } = prepareUtterance('ˈhḁ', { seed: 1, ...IPA });
    expect(middle(plan, plan.channels.whisper)).toBeGreaterThan(0.99);
    expect(planWhispers(prepareUtterance('ˈha', IPA).plan)).toBe(false);
  });

  it('does not change the pitch with the effort', () => {
    // A loud whisper is longer (the effort lengthens the sounds), so the
    // pitch is compared at the middle of each vowel.
    const vowelPitch = (input) => {
      const { plan } = prepareUtterance(input, BASE);
      return plan.segments
        .filter((segment) => segment.kind === 'vowel')
        .map((segment) => middle(plan, plan.channels.f0, segment));
    };
    const normal = vowelPitch(`[whisper]${TEXT}[/whisper]`);
    const loud = vowelPitch(`[whisper][loud]${TEXT}[/loud][/whisper]`);
    const plainLoud = vowelPitch(`[loud]${TEXT}[/loud]`);
    expect(loud.length).toBe(normal.length);
    loud.forEach((value, at) => {
      expect(Math.abs(value - normal[at])).toBeLessThan(1);
    });
    // Without a whisper the effort raises the pitch (here by > 30 Hz).
    expect(plainLoud[0] - normal[0]).toBeGreaterThan(30);
  });

  it('can prepare Rust frames for a whisper', () => {
    const { plan, renderOptions } = prepareUtterance('[whisper]ma[/whisper]', {
      markup: true,
    });
    const planner = new FramePlanner(plan, renderOptions);
    expect(planner.prepare(2048) > 0).toBe(true);
  });
});

describe('whisper source', () => {
  it('stops the pulses and their phase', () => {
    const glottis = new Glottis({ jitter: 0, shimmer: 0 });
    const control = {
      f0: 125,
      voicing: 1,
      aspiration: 0,
      closure: 0,
      loudness: 1,
      whisper: 1,
    };
    const phase = glottis.phase;
    let energy = 0;
    for (let n = 0; n < 4800; n++) {
      energy += glottis.step(1 / 48000, control, 0) ** 2;
    }
    expect(glottis.phase).toBe(phase);
    expect(energy).toBe(0);
  });

  it('drives the half-open glottis, less in a voiced closure', () => {
    const open = { whisper: 1, voicing: 1, closure: 0 };
    expect(whisperDrive(open)).toBe(1);
    expect(whisperDrive({ ...open, whisper: 0.5 })).toBe(0.5);
    expect(whisperDrive({ ...open, voicing: 0 })).toBe(0);
    expect(whisperDrive({ ...open, closure: 1 })).toBe(0);
    expect(whisperDrive({ ...open, stopClosure: 1 })).toBe(WHISPER_STOP_DRIVE);
    expect(whisperArea(0)).toBe(40);
    expect(whisperArea(-10)).toBe(40);
    expect(whisperArea(10)).toBe(20);
  });

  it('follows the intended pitch within the limit', () => {
    const decibels = (f0) => 20 * Math.log10(whisperPitchGain(f0, 120));
    expect(Math.abs(decibels(120 * 2 ** (1 / 12)) - 0.7) < 1e-9).toBe(true);
    expect(Math.abs(decibels(480) - WHISPER_PITCH_LIMIT) < 1e-9).toBe(true);
    expect(Math.abs(decibels(30) + WHISPER_PITCH_LIMIT) < 1e-9).toBe(true);
    expect(whisperPitchGain(0, 120)).toBe(1);
  });

  it('lowers the glottal reflection and keeps the burst of a stop', () => {
    const reflection = glottalReflection({});
    expect(reflection).toBe(GLOTTAL_REFLECTION);
    expect(whisperReflection(reflection, 0)).toBe(reflection);
    expect(whisperReflection(reflection, 1) < 0).toBe(true);
    expect(whisperTransient(0, 0)).toBe(1);
    expect(whisperTransient(1, 1)).toBe(1);
    expect(whisperTransient(1, 0)).toBe(0);
  });
});
