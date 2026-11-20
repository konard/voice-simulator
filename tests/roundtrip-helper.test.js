/** Check the metric definitions with controlled recognition results. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { roundTrip, sentenceMark, sentences } from './helpers/roundtrip.js';
import { synthesize } from '../src/index.js';

const render = { tier: 'telephone', preset: 'male', seed: 1, lang: 'en' };

it('has 20 sentences per language', () => {
  assert.deepEqual(Object.keys(sentences).sort(), ['en', 'hi', 'ru', 'zh']);
  for (const items of Object.values(sentences)) {
    assert.equal(items.length, 20);
    assert.ok(
      items.every(
        (text) =>
          typeof text === 'string' && text.trim() && !/\p{Nd}/u.test(text)
      )
    );
  }
});

it('counts a homophone as right', () => {
  const result = roundTrip('sea', {
    ...render,
    recognize: (_, rate, options) => {
      assert.equal(rate, 8000);
      assert.deepEqual(options, { level: 'low' });
      return {
        text: 'see',
        ipa: 'si',
        languages: [
          { language: 'ru', share: 0.1 },
          { language: 'en', share: 0.9 },
        ],
        words: [],
      };
    },
  });
  assert.equal(result.wer.distance, 1);
  assert.equal(result.soundWer.distance, 0);
  assert.equal(result.languageRight, true);
  assert.equal(result.timeErrors.mean, null);
});

it('counts tones', () => {
  const options = { ...render, lang: 'zh' };
  const { timeline } = synthesize('妈妈。', options);
  const syllables = timeline.words.flatMap((word) => word.syllables);
  assert.deepEqual(
    syllables.map(({ ipa }) => ipa.match(/[˥˦˧˨˩]+/u)?.[0] ?? ''),
    ['˥', '']
  );
  const result = roundTrip('妈妈。', {
    ...options,
    recognize: () => ({
      text: '妈妈。',
      ipa: 'ma˥˩ ma',
      languages: [{ language: 'zh', share: 1 }],
      words: [{ syllables: [{ ...syllables[0], ipa: 'ma˥˩' }, syllables[1]] }],
    }),
  });
  assert.equal(result.toneErrors.distance, 1);
  assert.equal(result.toneErrors.referenceLength, 2);
  assert.equal(result.toneErrors.rate, 0.5);
  assert.equal(result.sentenceMark, '.');
});

it('measures syllable times', () => {
  const text = 'She sells sea shells.';
  const { ipa, timeline } = synthesize(text, render);
  const words = timeline.words.map((word) => ({
    ...word,
    syllables: word.syllables.map((syllable) => ({
      ...syllable,
      start: syllable.start + 0.02,
      end: syllable.end + 0.02,
    })),
  }));
  // A leading insertion must not shift the matching reference syllables.
  words.unshift({ ipa: 'ə', syllables: [{ ipa: 'ə', start: 0, end: 0.04 }] });
  const result = roundTrip(text, {
    ...render,
    recognize: () => ({
      text,
      ipa,
      words,
      languages: [{ language: 'en', share: 1 }],
    }),
  });
  assert.equal(result.timeErrors.errors.length, 8);
  assert.ok(Math.abs(result.timeErrors.mean - 20) < 1e-9);
});

it('normalizes the last sentence mark', () => {
  assert.equal(sentenceMark('क्यों? हाँ।'), '.');
  assert.equal(sentenceMark('你好。你好吗？'), '?');
  assert.equal(sentenceMark('你好。请坐！'), '!');
  assert.equal(sentenceMark('undecided'), null);
});
