/**
 * The example app highlights the word and syllable being spoken; these
 * helpers split the text and IPA into tagged pieces and follow the clock.
 */

import { describe, it, expect } from 'test-anywhere';
import { prepareUtterance } from '../src/index.js';
import {
  HOLD,
  highlightAt,
  ipaPieces,
  paintHighlight,
  sameHighlight,
  textPieces,
} from '../examples/universal-app/src/components/highlight.js';

const timelineOf = (text, options) => prepareUtterance(text, options).timeline;

function fakeSpan(word, syllable) {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset:
      syllable === null
        ? { word: String(word) }
        : { word: String(word), syllable: String(syllable) },
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
}

function fakeRoot(pieces) {
  const spans = pieces
    .filter((piece) => piece.word !== null)
    .map((piece) => fakeSpan(piece.word, piece.syllable));
  return { spans, querySelectorAll: () => spans };
}

describe('textPieces', () => {
  it('splits the text into syllables and keeps punctuation untagged', () => {
    const text = 'Hello, simulated mountain.';
    const pieces = textPieces(text, timelineOf(text, { lang: 'en' }));
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
    expect(
      pieces
        .filter((piece) => piece.word === 1)
        .map((piece) => [piece.text, piece.syllable])
    ).toEqual([
      ['si', 0],
      ['mu', 1],
      ['la', 2],
      ['ted', 3],
    ]);
    expect(pieces.find((piece) => piece.text.includes(',')).word).toBe(null);
  });

  it('tags a verbalised date as one word without syllables', () => {
    const text = 'On 3/5/2024 we met';
    const pieces = textPieces(text, timelineOf(text, { lang: 'en' }));
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
    const date = pieces.find((piece) => piece.text === '3/5/2024');
    expect(date.word).toBe(1);
    expect(date.syllable).toBe(null);
  });

  it('covers Chinese, Hindi and Russian text', () => {
    for (const [text, lang] of [
      ['你好，声音', 'zh'],
      ['नमस्ते दुनिया', 'hi'],
      ['Привет, мир!', 'ru'],
    ]) {
      const pieces = textPieces(text, timelineOf(text, { lang }));
      expect(pieces.map((piece) => piece.text).join('')).toBe(text);
      expect(pieces.some((piece) => piece.syllable !== null)).toBe(true);
    }
  });

  it('returns the plain text without a timeline', () => {
    expect(textPieces('abc', null)).toEqual([
      { text: 'abc', word: null, syllable: null },
    ]);
  });
});

describe('ipaPieces', () => {
  it('separates syllables with dots unless a stress mark starts one', () => {
    const timeline = timelineOf('Hello world', { lang: 'en' });
    expect(ipaPieces(timeline).map((piece) => piece.text)).toEqual([
      'hə',
      'ˈloʊ',
      ' ',
      'ˈwɝld',
    ]);
    const russian = timelineOf('звуковых', { lang: 'ru' });
    expect(
      ipaPieces(russian)
        .map((piece) => piece.text)
        .join('')
    ).toBe('ˈzvu.kə.vɨx');
  });
});

describe('highlightAt', () => {
  const timeline = timelineOf('Hello, simulated mountain.', { lang: 'en' });
  const [hello, simulated] = timeline.words;

  it('follows the words and syllables of the timeline', () => {
    expect(highlightAt(timeline, hello.start - 0.001)).toBe(null);
    expect(highlightAt(timeline, hello.start)).toEqual({
      word: 0,
      syllable: 0,
    });
    expect(highlightAt(timeline, hello.syllables[1].start)).toEqual({
      word: 0,
      syllable: 1,
    });
    expect(highlightAt(timeline, simulated.syllables[2].start + 0.001)).toEqual(
      { word: 1, syllable: 2 }
    );
  });

  it('holds a word through the pause after it', () => {
    expect(simulated.start - hello.end > 0.1).toBe(true);
    expect(highlightAt(timeline, hello.end + 0.05)).toEqual({
      word: 0,
      syllable: 1,
    });
    const last = timeline.words.at(-1);
    expect(highlightAt(timeline, last.end + HOLD / 2)?.word).toBe(2);
    expect(highlightAt(timeline, last.end + HOLD)).toBe(null);
    expect(highlightAt(null, 1)).toBe(null);
  });

  it('compares highlights', () => {
    expect(
      sameHighlight({ word: 1, syllable: 0 }, { word: 1, syllable: 0 })
    ).toBe(true);
    expect(sameHighlight({ word: 1, syllable: 0 }, null)).toBe(false);
    expect(sameHighlight(null, null)).toBe(true);
  });
});

describe('paintHighlight', () => {
  it('marks the current word and syllable and clears them at the end', () => {
    const timeline = timelineOf('Hello world', { lang: 'en' });
    const root = fakeRoot(textPieces('Hello world', timeline));
    const [he, llo, world] = root.spans;
    paintHighlight(root, {
      speaking: true,
      time: timeline.words[0].syllables[1].start,
      timeline,
    });
    expect(he.classList.contains('word-current')).toBe(true);
    expect(he.classList.contains('syllable-current')).toBe(false);
    expect(llo.classList.contains('syllable-current')).toBe(true);
    expect(llo.getAttribute('aria-current')).toBe('true');
    expect(world.classList.contains('word-current')).toBe(false);
    paintHighlight(root, { speaking: false, time: 0, timeline: null });
    expect(llo.classList.contains('word-current')).toBe(false);
    expect(llo.getAttribute('aria-current')).toBe(null);
    paintHighlight(null, { speaking: true, time: 0, timeline });
  });
});
