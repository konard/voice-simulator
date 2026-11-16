/**
 * Paralinguistic sounds (issue 56): breaths, laughter, sighs, fillers,
 * coughs, throat clearing and clicks from the recipes of
 * src/articulation/sounds.js, written fillers and laughter in plain text,
 * the `breaths` option and the sounds of the timeline. Measured on the
 * real-time waveguide (tier medium) at seed 1.
 */

import { describe, it, expect } from 'test-anywhere';
import { runCli } from '../bin/voice-simulator.js';
import {
  BREATHS,
  FILLERS,
  SOUNDS,
  formantTrack,
  formatIpa,
  levelDb,
  parseIpa,
  pitchTrack,
  planUtterance,
  prepareUtterance,
  synthesize,
  textToIpa,
  voicedShare,
} from '../src/index.js';
import { synthesisOptions } from '../src/server/server.js';

const BASE = { tier: 'medium', seed: 1, markup: true };
const cache = new Map();

/** `synthesize(text, BASE + options)`, once per text and options. */
function speak(text, options = {}) {
  const key = JSON.stringify([text, options]);
  if (!cache.has(key)) {
    cache.set(key, synthesize(text, { ...BASE, ...options }));
  }
  return cache.get(key);
}

/** The samples of `from` … `to` seconds. */
function slice(result, from, to) {
  const { samples, sampleRate } = result;
  return samples.subarray(
    Math.round(from * sampleRate),
    Math.round(to * sampleRate)
  );
}

/** Level curve in dBFS of `step` seconds frames over `from` … `to`. */
function levelCurve(result, from, to, step) {
  const { samples, sampleRate } = result;
  const hop = Math.round(step * sampleRate);
  const curve = [];
  const end = Math.round(to * sampleRate);
  for (let at = Math.round(from * sampleRate); at + hop <= end; at += hop) {
    curve.push(levelDb(samples, at, at + hop));
  }
  return curve;
}

/**
 * The peaks of the 10 ms level curve of a sound: local maxima that stand
 * 6 dB above the lowest level between them and the peak before (the calls
 * of a laugh). Time in seconds from the start of the audio.
 */
function levelPeaks(result, sound) {
  const curve = levelCurve(result, sound.start, sound.end, 0.01);
  const peaks = [];
  let low = Infinity;
  for (let index = 1; index < curve.length - 1; index++) {
    const level = curve[index];
    low = Math.min(low, level);
    const top = level >= curve[index - 1] && level > curve[index + 1];
    const last = peaks.at(-1);
    if (top && level - low >= 6) {
      peaks.push({ level, time: sound.start + (index + 0.5) * 0.01 });
      low = Infinity;
    } else if (top && last && level > last.level && low > last.level - 6) {
      // A higher top of the same call.
      Object.assign(last, { level, time: sound.start + (index + 0.5) * 0.01 });
    }
  }
  return peaks;
}

const median = (values) => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** The f0 track (Hz, 0 unvoiced) of `from` … `to` seconds. */
const f0Track = (result, from, to) =>
  Array.from(pitchTrack(slice(result, from, to), result.sampleRate));

const semitones = (from, to) => 12 * Math.log2(from / to);

/** The segments of the parts of the sound `name` of a plan. */
const parts = (plan, name) =>
  plan.segments.filter((segment) => segment.soundOf?.sound === name);

describe('laughter', () => {
  it('laughs 4 calls in 0.8 s, falling by a semitone and 1.5 dB', () => {
    const result = speak('Yes [laugh]');
    const sound = result.plan.sounds.find((item) => item.name === 'laugh');
    expect(Math.abs(sound.end - sound.start - 0.8)).toBeLessThanOrEqual(0.1);
    const peaks = levelPeaks(result, sound);
    expect(peaks.length).toBe(4);
    for (let index = 1; index < peaks.length; index++) {
      const gap = peaks[index].time - peaks[index - 1].time;
      expect(Math.abs(gap - 0.2)).toBeLessThanOrEqual(0.03);
      const step = peaks[index - 1].level - peaks[index].level;
      expect(step).toBeGreaterThanOrEqual(0.5);
      expect(step).toBeLessThanOrEqual(3);
    }
    const vowels = parts(result.plan, 'laugh').filter(
      (segment) => segment.kind === 'vowel'
    );
    expect(vowels.length).toBe(4);
    const first = median(f0Track(result, vowels[0].start, vowels[0].end));
    const last = median(f0Track(result, vowels[3].start, vowels[3].end));
    const pitch = result.head.pitch;
    expect(Math.abs(first / (1.66 * pitch) - 1)).toBeLessThanOrEqual(0.1);
    expect(last).toBeLessThan(first);
  });

  it('gives a laugh of 1.2 s 6 calls', () => {
    const result = speak(
      '<speak>Yes <vs:sound name="laugh" duration="1.2s"/></speak>'
    );
    const sound = result.plan.sounds.find((item) => item.name === 'laugh');
    expect(levelPeaks(result, sound).length).toBe(6);
  });

  it('reads written laughter as a laugh of 0.2 s per syllable', () => {
    expect(textToIpa('hahaha', { lang: 'en' }).ipa).toBe('⸨laugh:0.6⸩');
    expect(textToIpa('Ha-ha!', { lang: 'en' }).ipa).toBe('⸨laugh:0.4⸩ !');
    expect(textToIpa('хаха', { lang: 'ru' }).ipa).toBe('⸨laugh:0.4⸩');
    expect(textToIpa('हाहाहा', { lang: 'hi' }).ipa).toBe('⸨laugh:0.6⸩');
    expect(textToIpa('哈哈', { lang: 'zh' }).ipa).toBe('⸨laugh:0.4⸩');
    // One syllable and words that only start like laughter stay words.
    expect(textToIpa('ha', { lang: 'en' }).ipa).toBe('ˈhɑ');
    expect(textToIpa('hahn', { lang: 'en' }).ipa).not.toContain('⸨');
    const result = speak('hahaha', { markup: undefined });
    expect(result.ipa).toBe('⸨laugh:0.6⸩');
    expect(levelPeaks(result, result.plan.sounds[0]).length).toBe(3);
    expect(result.timeline.words.map((word) => word.text)).toEqual(['hahaha']);
  });

  it('keeps the mode of its span: a whispered laugh is not voiced', () => {
    const result = speak('[whisper]Yes [laugh][/whisper]');
    const sound = result.plan.sounds.find((item) => item.name === 'laugh');
    const share = voicedShare(
      slice(result, sound.start, sound.end),
      result.sampleRate
    );
    expect(share).toBeLessThan(0.05);
    expect(
      voicedShare(slice(speak('Yes [laugh]'), sound.start, sound.end), 24000)
    ).toBeGreaterThan(0.2);
  });

  it('plans [laugh] as the IPA ⸨laugh⸩', () => {
    const marked = speak('Yes [laugh]');
    const ipa = speak('ˈjɛs ⸨laugh⸩', { ipa: true, markup: undefined });
    expect(ipa.plan.sounds).toEqual(marked.plan.sounds);
    for (const [name, channel] of Object.entries(marked.plan.channels)) {
      expect(Array.from(ipa.plan.channels[name])).toEqual(Array.from(channel));
    }
  });
});

describe('breaths', () => {
  it('breathes in for 0.4 s, quiet and unvoiced', () => {
    const result = speak('[inhale] Yes');
    const sound = result.plan.sounds[0];
    expect(sound.name).toBe('inhale');
    expect(Math.abs(sound.end - sound.start - 0.4)).toBeLessThanOrEqual(0.05);
    const breath = slice(result, sound.start, sound.end);
    expect(voicedShare(breath, result.sampleRate)).toBe(0);
    const vowel = result.plan.segments.find(
      (segment) => segment.kind === 'vowel' && !segment.soundOf
    );
    const vowelLevel = levelDb(
      result.samples,
      Math.round(vowel.start * result.sampleRate),
      Math.round(vowel.end * result.sampleRate)
    );
    const breathLevel = levelDb(breath, 0, breath.length);
    expect(vowelLevel - breathLevel).toBeGreaterThanOrEqual(20);
    expect(vowelLevel - breathLevel).toBeLessThanOrEqual(40);
    expect(breathLevel).toBeGreaterThan(-70);
  });

  it('puts an inhale in the pause between sentences with `breaths`', () => {
    const text = 'One. Two three four five six seven.';
    const result = prepareUtterance(text, { ...BASE, breaths: true });
    const breaths = result.plan.sounds.filter(
      (sound) => sound.name === 'inhale'
    );
    expect(breaths.length).toBe(1);
    const [one, two] = result.timeline.words;
    const [breath] = breaths;
    expect(breath.start).toBeGreaterThanOrEqual(one.end);
    expect(Math.abs(two.start - breath.end - BREATHS.gap)).toBeLessThan(1e-6);
    const short = prepareUtterance('One. Two.', { ...BASE, breaths: true });
    const shortBreath = short.plan.sounds.find(
      (sound) => sound.name === 'inhale'
    );
    expect(shortBreath.end - shortBreath.start).toBeLessThan(
      breath.end - breath.start
    );
    expect(result.timeline.sounds).toEqual(
      breaths.map(({ name, start, end }) => ({ name, start, end }))
    );
  });

  it('changes nothing without the option, nor at the start', () => {
    const text = 'One. Two three.';
    const plain = speak(text, { markup: undefined });
    const off = speak(text, { markup: undefined, breaths: false });
    expect(plain.plan.sounds).toEqual([]);
    expect(Array.from(off.samples)).toEqual(Array.from(plain.samples));
    const start = prepareUtterance('… One.', { ...BASE, breaths: true });
    expect(start.plan.sounds).toEqual([]);
  });

  it('takes --breaths in the CLI and `breaths` in the server', async () => {
    const lines = [];
    const io = { stdout: (line) => lines.push(line), stderr: () => {} };
    await runCli(['timeline', '--breaths', 'One. Two three.'], io);
    expect(lines.some((line) => line.includes('⸨inhale⸩'))).toBe(true);
    expect(
      synthesisOptions({ text: 'Hi', breaths: 'true' }).options.breaths
    ).toBe(true);
    expect(synthesisOptions({ text: 'Hi' }).options.breaths).toBe(undefined);
  });
});

describe('fillers', () => {
  for (const lang of ['en', 'ru', 'hi', 'zh']) {
    it(`hesitates in ${lang}: a steady voiced vowel, falling in pitch`, () => {
      const result = speak('[filler]', { lang });
      const sound = result.plan.sounds[0];
      expect(Math.abs(sound.end - sound.start - 0.35)).toBeLessThanOrEqual(
        0.05
      );
      const part = slice(result, sound.start, sound.end);
      expect(voicedShare(part, result.sampleRate)).toBeGreaterThan(0.5);
      const pitch = pitchTrack(part, result.sampleRate);
      const f1 = formantTrack(part, result.sampleRate, { pitch }).map(
        (formants) => (formants ? formants[0] : 0)
      );
      const third = Math.floor(f1.length / 3);
      const f1Start = median(f1.slice(0, third));
      const f1End = median(f1.slice(-third));
      expect(Math.abs(f1End - f1Start) / f1Start).toBeLessThan(0.1);
      const voiced = Array.from(pitch).filter((value) => value > 0);
      const fall = semitones(
        median(voiced.slice(0, 5)),
        median(voiced.slice(-5))
      );
      expect(fall).toBeGreaterThanOrEqual(0);
      expect(fall).toBeLessThanOrEqual(2);
    });
  }

  it('lists the fillers of each language', () => {
    expect(FILLERS.filler).toEqual({ en: 'əː', ru: 'ɛː', hi: 'əː', zh: 'ɤː' });
    expect(FILLERS.um).toEqual({ en: 'əːm', ru: 'ɛːm', hi: 'ə̃ː', zh: 'ŋ̍ː' });
  });

  for (const [text, lang, ipa] of [
    ['um', 'en', '⸨um⸩'],
    ['э-э', 'ru', '⸨filler⸩'],
    ['嗯', 'zh', '⸨um⸩'],
    ['अं', 'hi', '⸨um⸩'],
  ]) {
    it(`reads the written ${lang} filler ${text} as ${ipa}`, () => {
      expect(textToIpa(text, { lang }).ipa).toBe(ipa);
      const { timeline } = prepareUtterance(text, { lang, seed: 1 });
      expect(timeline.words.length).toBe(1);
      expect(timeline.words[0].text).toBe(text);
      expect(timeline.words[0].sound).toBe(ipa.slice(1, -1));
      expect(timeline.sounds.map((sound) => sound.name)).toEqual([
        ipa.slice(1, -1),
      ]);
    });
  }
});

describe('sighs, coughs, throat clearing and clicks', () => {
  it('sighs: a breathy vowel of 0.6 s or more, 6 semitones down', () => {
    const result = speak('[sigh]');
    const [, vowel] = parts(result.plan, 'sigh');
    expect(vowel.end - vowel.start).toBeGreaterThanOrEqual(0.6);
    const track = f0Track(result, vowel.start, vowel.end);
    const fall = semitones(
      median(track.slice(0, 15)),
      median(track.slice(-15))
    );
    expect(Math.abs(fall - 6)).toBeLessThanOrEqual(1.5);
  });

  it('coughs twice, each burst rising 20 dB within 20 ms, unvoiced', () => {
    const result = speak('[cough]');
    const sound = result.plan.sounds[0];
    expect(
      voicedShare(slice(result, sound.start, sound.end), result.sampleRate)
    ).toBeLessThan(0.1);
    const bursts = parts(result.plan, 'cough').filter(
      (segment) => segment.noise
    );
    expect(bursts.length).toBe(2);
    for (const burst of bursts) {
      const before = levelCurve(result, burst.start - 0.01, burst.start, 0.001);
      const after = levelCurve(result, burst.start, burst.start + 0.02, 0.001);
      expect(Math.max(...after) - Math.min(...before)).toBeGreaterThanOrEqual(
        20
      );
    }
  });

  it('clears the throat in two low, voiced parts', () => {
    const result = speak('[throat]');
    const voicedParts = parts(result.plan, 'throat').filter(
      (segment) => segment.phonation
    );
    expect(voicedParts.length).toBe(2);
    for (const part of voicedParts) {
      const samples = slice(result, part.start, part.end);
      expect(voicedShare(samples, result.sampleRate)).toBeGreaterThan(0.3);
      expect(median(f0Track(result, part.start, part.end))).toBeLessThan(70);
    }
  });

  it('clicks as the click letter ǀ, with a burst under 20 ms', () => {
    const sound = speak('[click]');
    const letter = speak('ǀ', { ipa: true, markup: undefined });
    expect(sound.plan.duration).toBe(letter.plan.duration);
    for (const [name, channel] of Object.entries(sound.plan.channels)) {
      expect(Array.from(letter.plan.channels[name])).toEqual(
        Array.from(channel)
      );
    }
    const curve = levelCurve(sound, 0, sound.duration, 0.001);
    const peak = Math.max(...curve);
    const loud = curve.flatMap((level, index) =>
      level > peak - 10 ? [index] : []
    );
    expect(loud.at(-1) - loud[0] + 1).toBeLessThan(20);
  });
});

describe('sounds in the IPA, the plan and the timeline', () => {
  it('has a recipe for every sound', () => {
    expect(Object.keys(SOUNDS).sort()).toEqual(
      [
        'click',
        'cough',
        'exhale',
        'filler',
        'inhale',
        'laugh',
        'sigh',
        'throat',
        'um',
      ].sort()
    );
  });

  it('writes sounds and click letters back with formatIpa', () => {
    for (const ipa of ['⸨laugh:1.2⸩ jɛs', '⸨sigh⸩', 'ǀ ǃ ǁ ʘ']) {
      expect(formatIpa(parseIpa(ipa).tokens)).toBe(ipa);
    }
  });

  it('stretches a sound by its duration, a laugh by its calls', () => {
    const plan = (ipa) => planUtterance(ipa, {}).sounds[0];
    const inhale = plan('⸨inhale:0.8⸩');
    expect(Math.abs(inhale.end - inhale.start - 0.8)).toBeLessThan(1e-6);
    const laugh = plan('⸨laugh:0.45⸩');
    expect(Math.abs(laugh.end - laugh.start - 0.4)).toBeLessThan(1e-6);
    const long = plan('⸨laugh:9⸩');
    expect(Math.abs(long.end - long.start - 2.4)).toBeLessThan(1e-6);
  });

  it('times a sound between the words, not as a word', () => {
    const { timeline } = prepareUtterance('Yes [laugh] no', BASE);
    expect(timeline.words.map((word) => word.text)).toEqual(['Yes', 'no']);
    expect(timeline.sounds.length).toBe(1);
    const [yes, no] = timeline.words;
    const [laugh] = timeline.sounds;
    expect(laugh.name).toBe('laugh');
    expect(laugh.start).toBeGreaterThanOrEqual(yes.end);
    expect(laugh.end).toBeLessThanOrEqual(no.start);
  });
});
