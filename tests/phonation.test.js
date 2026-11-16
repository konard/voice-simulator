/**
 * Phonation types (issue 54): breathy, lax, pressed, creaky, falsetto and
 * harsh voice from the markup, the a̤ and a̰ diacritics, the breathy-voiced
 * stops of Hindi and the phrase-final creak of the head. Every utterance
 * is rendered on tier medium with seed 1; the numbers the thresholds are
 * set against come from experiments/issue-54-measures.mjs and
 * experiments/issue-54-scenarios.mjs.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  PHONATION,
  analyzeVoice,
  cpp,
  jitterPercent,
  phonationChannels,
  pulseF0,
  pulseH1H2,
  synthesize,
} from '../src/index.js';
import { lfParameters } from '../src/acoustics/glottis.js';
import { voicedShare } from './helpers/accent-measures.js';

const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1 };
const semitones = (f0, reference) => 12 * Math.log2(f0 / reference);
const rendered = new Map();

/** Render (once) and measure `text` with `options` on tier medium, seed 1. */
function render(text, options = {}) {
  const key = JSON.stringify([text, options]);
  if (!rendered.has(key)) {
    const result = synthesize(text, { ...BASE, ...options });
    const { samples, sampleRate } = result;
    const voice = analyzeVoice(samples, sampleRate);
    rendered.set(key, {
      result,
      voice,
      cpp: cpp(samples, sampleRate),
      jitter: jitterPercent(samples, sampleRate),
      pulseF0: pulseF0(samples, sampleRate),
      pulseH1H2: pulseH1H2(samples, sampleRate),
    });
  }
  return rendered.get(key);
}

/** The test sentence in a phonation of `degree`. */
function phonation(name, degree = 1) {
  return render(
    `<speak><vs:phonation name="${name}" degree="${degree}">${TEXT}</vs:phonation></speak>`,
    { markup: true }
  );
}

const modal = () => render(TEXT, { markup: true });
const vowels = (result) =>
  result.plan.segments.filter((segment) => segment.kind === 'vowel');
const slice = (result, { start, end }) =>
  result.samples.subarray(
    Math.round(start * result.sampleRate),
    Math.round(end * result.sampleRate)
  );
const spanVoice = (result, span) =>
  analyzeVoice(slice(result, span), result.sampleRate);

describe('phonation types (issue 54)', () => {
  it('sets Rd, tension and the other channels from the PHONATION table', () => {
    const head = { tenseness: 0.6 };
    const rdVoice = 3 * (1 - head.tenseness);
    for (const [name, row] of Object.entries(PHONATION)) {
      const phonation =
        name === 'lax' || name === 'pressed'
          ? { tension: name === 'pressed' ? 1 : -1 }
          : { [name]: 1 };
      const channels = phonationChannels({ phonation }, null, head);
      expect(Math.abs(channels.tension - (rdVoice - row.rd) / 3)).toBeLessThan(
        1e-9
      );
      for (const channel of ['breath', 'creak', 'falsetto', 'harsh']) {
        expect(channels[channel]).toBe(row[channel] ?? 0);
      }
    }
    // The pressed Rd 0.4 is not clamped any more (0.3).
    expect(
      Math.abs(lfParameters(0.6 + (rdVoice - 0.4) / 3).rd - 0.4)
    ).toBeLessThan(1e-9);
    expect(lfParameters(1).rd).toBe(0.3);
  });

  it('breathy: higher H1-H2, lower HNR and CPP, the same f0', () => {
    const plain = modal();
    const breathy = phonation('breathy');
    expect(breathy.voice.h1h2).toBeGreaterThanOrEqual(7);
    expect(breathy.voice.h1h2).toBeGreaterThanOrEqual(plain.voice.h1h2 + 4);
    expect(breathy.voice.hnr).toBeLessThanOrEqual(plain.voice.hnr - 4);
    expect(breathy.cpp).toBeLessThanOrEqual(plain.cpp - 3);
    expect(
      Math.abs(semitones(breathy.voice.f0, plain.voice.f0))
    ).toBeLessThanOrEqual(1);
  });

  it('pressed: H1-H2 at most 0 dB and 4 dB below modal, HNR kept', () => {
    const plain = modal();
    const pressed = phonation('pressed');
    expect(pressed.voice.h1h2).toBeLessThanOrEqual(0);
    expect(pressed.voice.h1h2).toBeLessThanOrEqual(plain.voice.h1h2 - 4);
    expect(pressed.voice.hnr).toBeGreaterThanOrEqual(plain.voice.hnr - 2);
  });

  it('lax: H1-H2 2 to 6 dB above modal, HNR kept', () => {
    const plain = modal();
    const lax = phonation('lax');
    const rise = lax.voice.h1h2 - plain.voice.h1h2;
    expect(rise).toBeGreaterThanOrEqual(2);
    expect(rise).toBeLessThanOrEqual(6);
    expect(lax.voice.hnr).toBeGreaterThanOrEqual(plain.voice.hnr - 2);
  });

  it('creaky: an octave lower, irregular and pressed', () => {
    const plain = modal();
    const creaky = phonation('creaky');
    const shift = semitones(creaky.pulseF0, plain.pulseF0);
    expect(shift).toBeGreaterThanOrEqual(-14);
    expect(shift).toBeLessThanOrEqual(-10);
    expect(creaky.jitter).toBeGreaterThanOrEqual(5);
    // Pitch-synchronous: YIN of analyzeVoice() stops at 60 Hz.
    expect(creaky.pulseH1H2).toBeLessThan(0);
    const vowel = render('{C ˈa C}', { ipa: true });
    expect(vowel.pulseF0).toBeLessThan(70);
  });

  it('falsetto: an octave higher with a steep source', () => {
    const plain = modal();
    const falsetto = phonation('falsetto');
    const shift = semitones(falsetto.voice.f0, plain.voice.f0);
    expect(shift).toBeGreaterThanOrEqual(11);
    expect(shift).toBeLessThanOrEqual(13);
    expect(falsetto.voice.h1h2).toBeGreaterThanOrEqual(8);
  });

  it('harsh: pressed, noisy and irregular', () => {
    const plain = modal();
    const harsh = phonation('harsh');
    expect(harsh.voice.h1h2).toBeLessThanOrEqual(0);
    expect(harsh.voice.hnr).toBeLessThanOrEqual(plain.voice.hnr - 5);
    expect(harsh.jitter).toBeGreaterThanOrEqual(3);
  });

  it('grades breathy voice by degree', () => {
    const low = phonation('breathy', 0.33).voice.h1h2;
    const middle = phonation('breathy', 0.67).voice.h1h2;
    const full = phonation('breathy', 1).voice.h1h2;
    expect(low).toBeLessThan(middle);
    expect(middle).toBeLessThan(full);
  });
});

describe('phonation of one vowel and of stops (issue 54)', () => {
  it('a̤ and a̰ change only their vowel', () => {
    const breathy = render('ˈma̤ma', { ipa: true }).result;
    const [first, second] = vowels(breathy);
    expect(spanVoice(breathy, first).h1h2).toBeGreaterThanOrEqual(
      spanVoice(breathy, second).h1h2 + 4
    );
    const plain = render('ˈmama', { ipa: true }).result;
    const creaky = render('ˈma̰ma', { ipa: true }).result;
    const plainF0 = pulseF0(plain.samples, plain.sampleRate, vowels(plain)[0]);
    const creakyF0 = pulseF0(
      creaky.samples,
      creaky.sampleRate,
      vowels(creaky)[0]
    );
    expect(semitones(creakyF0, plainF0)).toBeLessThanOrEqual(-6);
  });

  it('gives Hindi breathy-voiced stops a breathy voiced release', () => {
    const { result } = render('paː pʰaː baː bʱaː', { ipa: true, lang: 'hi' });
    const words = [];
    for (const segment of result.plan.segments) {
      if (segment.kind === 'consonant') {
        words.push([]);
      }
      if (segment.kind !== 'pause') {
        words.at(-1).push(segment);
      }
    }
    expect(words.length).toBe(4);
    const [, aspirated, voiced, breathy] = words;
    expect(breathy.map((segment) => segment.kind)).toEqual([
      'consonant',
      'release',
      'vowel',
    ]);
    const release = breathy[1];
    expect(Math.abs(release.end - release.start - 0.08)).toBeLessThanOrEqual(
      0.005
    );
    expect(voicedShare(result, release)).toBeGreaterThan(0.8);
    expect(voicedShare(result, aspirated[1])).toBeLessThan(0.2);
    const vowel = voiced.find((segment) => segment.kind === 'vowel');
    const onset = { start: vowel.start, end: vowel.start + 0.08 };
    expect(spanVoice(result, release).h1h2).toBeGreaterThanOrEqual(
      spanVoice(result, onset).h1h2 + 4
    );
  });
});

describe('phrase-final creak (issue 54)', () => {
  it('creaks the low end of a statement with finalCreak', () => {
    const { result } = render('You are coming.', { head: { finalCreak: 1 } });
    const [first, ...rest] = vowels(result);
    const { samples, sampleRate } = result;
    expect(jitterPercent(samples, sampleRate, rest.at(-1))).toBeGreaterThan(5);
    expect(jitterPercent(samples, sampleRate, first)).toBeLessThan(2);
  });

  it('leaves the default head alone', () => {
    const plain = render('You are coming.').result;
    const zero = render('You are coming.', { head: { finalCreak: 0 } }).result;
    expect(plain.plan.channels.creak.every((value) => value === 0)).toBe(true);
    expect(plain.samples.length).toBe(zero.samples.length);
    expect(
      plain.samples.every((value, index) => value === zero.samples[index])
    ).toBe(true);
  });

  it('gives the text markup the creak of the same IPA markup', () => {
    const text = render('[creaky]ma[/creaky]', { markup: true }).result;
    const ipa = render(text.ipa, { ipa: true }).result;
    expect(text.ipa).toBe('{V̰ ˈmɑ V̰}');
    expect(Array.from(text.plan.channels.creak)).toEqual(
      Array.from(ipa.plan.channels.creak)
    );
    // `{V̰ ma V̰}` has another vowel and no stress, so another length, but
    // the same creak of degree 0.67 (smoothed with τ 0.03 s).
    const written = render('{V̰ ma V̰}', { ipa: true }).result;
    expect(
      Math.abs(
        Math.max(...written.plan.channels.creak) -
          Math.max(...text.plan.channels.creak)
      )
    ).toBeLessThan(0.01);
  });
});
