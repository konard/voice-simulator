/**
 * Punctuation prosody: pause lengths, final contours, declination resets
 * and register shifts for exclamations and parentheticals.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import {
  BOUNDARIES,
  intonationPhrases,
  phraseContour,
} from '../src/articulation/prosody.js';
import { textToIpa } from '../src/g2p/index.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const HEAD = normalizeHeadConfig({ pitch: 150, vibrato: 0 });

function plan(text, lang = 'en') {
  const { ipa } = textToIpa(text, { lang });
  return planUtterance(ipa, { head: HEAD, language: lang });
}

function f0At(utterance, time) {
  const frame = Math.round(time * utterance.frameRate);
  return utterance.channels.f0[Math.min(utterance.frameCount - 1, frame)];
}

const vowels = (utterance) =>
  utterance.segments.filter((segment) => segment.kind === 'vowel');

/** Pitch near the end of the last vowel. */
const finalF0 = (utterance) =>
  f0At(utterance, vowels(utterance).at(-1).end - 0.01);

/** Pause segments that separate phrases, with their boundary class. */
const pauses = (utterance) =>
  utterance.segments
    .slice(1)
    .filter((segment) => segment.kind === 'pause' && segment.strength >= 1);

describe('punctuation pauses', () => {
  it('gives each punctuation mark its own pause length', () => {
    const utterance = plan('Red, green; blue (white) — black... Done.');
    const lengths = Object.fromEntries(
      pauses(utterance).map((pause) => [pause.boundary, pause.duration])
    );
    expect(lengths.comma).toBe(BOUNDARIES.comma.pause);
    expect(lengths.semicolon).toBe(BOUNDARIES.semicolon.pause);
    expect(lengths.ellipsis).toBe(BOUNDARIES.ellipsis.pause);
    expect(lengths.comma < lengths.semicolon).toBe(true);
    expect(lengths.semicolon < lengths.ellipsis).toBe(true);
    expect(utterance.segments.at(-1).duration >= BOUNDARIES.period.pause).toBe(
      true
    );
  });

  it('makes a comma longer than no punctuation', () => {
    const plain = plan('red green').duration;
    const comma = plan('red, green').duration;
    expect(comma - plain > 0.15).toBe(true);
  });

  it('lengthens the syllable before an ellipsis', () => {
    const period = vowels(plan('It is red.')).at(-1).duration;
    const ellipsis = vowels(plan('It is red...')).at(-1).duration;
    expect(ellipsis > period * 1.2).toBe(true);
  });
});

describe('punctuation intonation', () => {
  it('raises the end of a yes/no question above a statement', () => {
    const statement = finalF0(plan('It is red.'));
    const question = finalF0(plan('Is it red?'));
    expect(question > statement * 1.2).toBe(true);
  });

  it('lets wh-questions fall like statements', () => {
    const statement = finalF0(plan('It is red.'));
    const yesNo = finalF0(plan('Is it red?'));
    const wh = finalF0(plan('What is red?'));
    expect(wh < yesNo * 0.85).toBe(true);
    expect(Math.abs(wh - statement) / statement < 0.05).toBe(true);
  });

  it('keeps the pitch up before a comma', () => {
    const comma = plan('Red, green.');
    const firstEnd = f0At(comma, vowels(comma)[0].end - 0.01);
    const period = plan('Red. Green.');
    const periodEnd = f0At(period, vowels(period)[0].end - 0.01);
    expect(firstEnd > periodEnd * 1.15).toBe(true);
  });

  it('resets declination at each sentence', () => {
    const sentences = plan('One two three. One two three.');
    const phrase = plan('One two three, one two three.');
    const startOf = (utterance) =>
      f0At(utterance, vowels(utterance)[3].start + 0.02);
    expect(startOf(sentences) > startOf(phrase) * 1.03).toBe(true);
  });

  it('raises and strengthens exclamations', () => {
    const statement = plan('It is red.');
    const exclamation = plan('It is red!');
    const first = (utterance) => vowels(utterance)[0];
    const middle = (segment) => (segment.start + segment.end) / 2;
    expect(
      f0At(exclamation, middle(first(exclamation))) >
        f0At(statement, middle(first(statement))) * 1.05
    ).toBe(true);
    const loudness = (utterance) =>
      utterance.channels.loudness[
        Math.round(middle(first(utterance)) * utterance.frameRate)
      ];
    expect(loudness(exclamation) > loudness(statement) * 1.3).toBe(true);
  });

  it('lowers and softens parentheticals', () => {
    const utterance = plan('Take the red one (the old one) home.');
    const inside = vowels(utterance).filter(
      (segment) => segment.token.parenthetical
    );
    const outside = vowels(utterance).filter(
      (segment) => !segment.token.parenthetical
    );
    expect(inside.length > 0).toBe(true);
    const loudness = (segment) =>
      utterance.channels.loudness[
        Math.round(((segment.start + segment.end) / 2) * utterance.frameRate)
      ];
    expect(loudness(inside[0]) < loudness(outside[0]) * 0.8).toBe(true);
  });

  it('chooses a contour per boundary', () => {
    expect(phraseContour({ boundary: 'comma', strength: 2 })).toBe(
      'continuation'
    );
    expect(phraseContour({ boundary: 'question', question: true })).toBe(
      'rise'
    );
    expect(
      phraseContour({ boundary: 'question', question: true, contour: 'fall' })
    ).toBe('fall');
    expect(phraseContour(null)).toBe('fall');
  });

  it('groups phrases into sentences with their register', () => {
    const utterance = plan('Wow, great! Fine.');
    const phrases = intonationPhrases(utterance.segments);
    expect(phrases.map((phrase) => phrase.register)).toEqual([
      'exclamation',
      'exclamation',
      'neutral',
    ]);
    expect(phrases.map((phrase) => phrase.step)).toEqual([0, 1, 0]);
  });

  it('keeps Mandarin tones and still reads the punctuation pauses', () => {
    const utterance = plan('你好，世界。', 'zh');
    expect(pauses(utterance)[0].boundary).toBe('comma');
  });
});
