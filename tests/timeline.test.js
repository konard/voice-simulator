/**
 * Word and syllable timeline: the times follow the planned audio and
 * every word and syllable points back at the text that spells it.
 */

import { describe, it, expect } from 'test-anywhere';
import { prepareUtterance } from '../src/synthesize.js';
import { timelineAt, utteranceTimeline } from '../src/articulation/timeline.js';
import { hindiAksharas, syllableSpans } from '../src/g2p/orthography.js';

const timeline = (text, options) => prepareUtterance(text, options).timeline;

const spelled = (text, word) =>
  word.syllables.map((syllable) =>
    text.slice(syllable.sourceStart, syllable.sourceEnd)
  );

function expectOrdered(result) {
  let previous = 0;
  for (const word of result.words) {
    expect(word.start >= previous).toBe(true);
    expect(word.end > word.start).toBe(true);
    expect(word.syllables[0].start).toBe(word.start);
    expect(word.syllables.at(-1).end).toBe(word.end);
    for (const syllable of word.syllables) {
      expect(syllable.start >= previous).toBe(true);
      expect(syllable.end > syllable.start).toBe(true);
      previous = syllable.end;
    }
  }
  expect(previous <= result.duration).toBe(true);
}

describe('utteranceTimeline', () => {
  const samples = [
    ['en', 'Hello! This voice is simulated by sound waves in a 3D head.'],
    ['ru', 'Привет! Этот голос рождается из звуковых волн в модели головы.'],
    ['hi', 'नमस्ते! यह आवाज़ सिर के मॉडल में ध्वनि तरंगों से बनती है।'],
    ['zh', '你好！这个声音是由头部模型里的声波模拟出来的。'],
  ];

  for (const [lang, text] of samples) {
    it(`orders the ${lang} words and syllables inside the audio`, () => {
      const prepared = prepareUtterance(text, { lang });
      const result = prepared.timeline;
      expect(result.duration).toBe(prepared.plan.duration);
      expectOrdered(result);
      const sourceStarts = result.words.map((word) => word.sourceStart);
      expect(sourceStarts).toEqual([...sourceStarts].sort((a, b) => a - b));
      for (const word of result.words) {
        expect(text.slice(word.sourceStart, word.sourceEnd)).toBe(word.text);
      }
    });
  }

  it('covers the speech from the first sound to the last', () => {
    const { plan, timeline: result } = prepareUtterance('Hello, world.', {
      lang: 'en',
    });
    const spoken = plan.segments.filter((segment) => segment.token?.word >= 0);
    expect(result.words[0].start).toBe(spoken[0].start);
    expect(result.words.at(-1).end).toBe(spoken.at(-1).end);
    expect(result.words.map((word) => word.text)).toEqual(['Hello', 'world']);
  });

  it('maps the source ranges of English words and syllables', () => {
    const text = 'Hello simulated mountain';
    const result = timeline(text, { lang: 'en' });
    expect(
      result.words.map((word) => [word.sourceStart, word.sourceEnd])
    ).toEqual([
      [0, 5],
      [6, 15],
      [16, 24],
    ]);
    expect(spelled(text, result.words[0])).toEqual(['Hel', 'lo']);
    expect(spelled(text, result.words[1])).toEqual(['si', 'mu', 'la', 'ted']);
    expect(spelled(text, result.words[2])).toEqual(['moun', 'tain']);
    expect(result.words[1].syllables.map((s) => s.stress)).toEqual([
      1, 0, 2, 0,
    ]);
  });

  it('gives each Chinese character its own syllable', () => {
    const text = '这个声音';
    const result = timeline(text, { lang: 'zh' });
    const words = result.words.map((word) => word.text);
    expect(words).toEqual(['这', '个', '声音']);
    expect(spelled(text, result.words[2])).toEqual(['声', '音']);
    expect(result.words[2].syllables.map((s) => s.ipa)).toEqual([
      'ʂəŋ˥',
      'in˥',
    ]);
  });

  it('spells Hindi syllables as aksharas', () => {
    const text = 'नमस्ते बनती तरंगों';
    const result = timeline(text, { lang: 'hi' });
    expect(spelled(text, result.words[0])).toEqual(['न', 'म', 'स्ते']);
    expect(spelled(text, result.words[1])).toEqual(['बन', 'ती']);
    expect(spelled(text, result.words[2])).toEqual(['त', 'रं', 'गों']);
  });

  it('spells Russian syllables around their vowel letters', () => {
    const text = 'звуковых головы';
    const result = timeline(text, { lang: 'ru' });
    expect(spelled(text, result.words[0])).toEqual(['зву', 'ко', 'вых']);
    expect(spelled(text, result.words[1])).toEqual(['го', 'ло', 'вы']);
  });

  it('keeps verbalised text as one word without syllable spelling', () => {
    const text = 'On 3/5/2024 the U.S.A. paid';
    const result = timeline(text, { lang: 'en' });
    expect(result.words.map((word) => word.text)).toEqual([
      'On',
      '3/5/2024',
      'the',
      'U.S.A.',
      'paid',
    ]);
    const date = result.words[1];
    expect([date.sourceStart, date.sourceEnd]).toEqual([3, 11]);
    expect(date.syllables.length > 4).toBe(true);
    expect(date.syllables.every((s) => s.text === undefined)).toBe(true);
    expectOrdered(result);
  });

  it('follows the accent of the transcription', () => {
    const result = timeline('water', { lang: 'en', accent: 'en-GB' });
    expect(result.words[0].ipa).toBe('ˈwɔːtə');
    expect(spelled('water', result.words[0])).toEqual(['wa', 'ter']);
  });

  it('maps raw IPA input chunk by chunk', () => {
    const ipa = 'həˈloʊ, ˈwɝld';
    const result = timeline(ipa, { ipa: true });
    expect(result.words.map((word) => word.text)).toEqual(['həˈloʊ,', 'ˈwɝld']);
    expect(result.words.map((word) => word.sourceStart)).toEqual([0, 8]);
    expect(result.words[0].syllables.map((s) => s.ipa)).toEqual(['hə', 'ˈloʊ']);
  });

  it('still times the words when the transcription does not match', () => {
    const { plan } = prepareUtterance('one two', { lang: 'en' });
    const result = utteranceTimeline(plan, {
      words: [{ text: 'x', original: 'x', ipa: 'x', sourceStart: 0 }],
    });
    expect(result.words.length).toBe(2);
    expect(result.words[0].sourceStart).toBe(null);
    expectOrdered(result);
  });
});

describe('timelineAt', () => {
  it('finds the word and syllable spoken at a time', () => {
    const result = timeline('Hello, simulated world.', { lang: 'en' });
    const [hello, simulated] = result.words;
    expect(timelineAt(result, hello.start)).toEqual({ word: 0, syllable: 0 });
    const third = simulated.syllables[2];
    expect(timelineAt(result, (third.start + third.end) / 2)).toEqual({
      word: 1,
      syllable: 2,
    });
    expect(timelineAt(result, (hello.end + simulated.start) / 2)).toBe(null);
    expect(timelineAt(result, -1)).toBe(null);
    expect(timelineAt(result, result.duration + 1)).toBe(null);
    expect(timelineAt(null, 0)).toBe(null);
  });
});

describe('syllableSpans', () => {
  const counts = (n) =>
    Array.from({ length: n }, () => ({ onset: 1, coda: 0, size: 2 }));

  it('splits letters by phone counts when vowels cannot be aligned', () => {
    expect(syllableSpans('rhythm', counts(2))).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
    expect(syllableSpans('rhythm', counts(2), { exactOnly: true })).toBe(null);
  });

  it('refuses spellings that cannot hold the syllables', () => {
    expect(syllableSpans('', counts(1))).toBe(null);
    expect(syllableSpans('你', counts(2))).toBe(null);
  });

  it('marks deleted Hindi schwas', () => {
    expect(hindiAksharas('बनती').map((akshara) => akshara.voiced)).toEqual([
      true,
      false,
      true,
    ]);
  });
});
