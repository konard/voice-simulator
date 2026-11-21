/** Check the metric definitions with controlled recognition results. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  roundTripReport,
  summarizeRoundTrips,
} from './heavy/helpers/roundtrip-report.js';
import { roundTrip, sentenceMark, sentences } from './helpers/roundtrip.js';
import { synthesize } from '../src/index.js';

const render = {
  tier: 'telephone',
  head: 'random',
  preset: 'male',
  seed: 1,
  lang: 'en',
};

it('renders the selected voice preset', () => {
  const recognize = () => ({ text: '', ipa: '', languages: [], words: [] });
  const male = roundTrip('Yes.', { ...render, recognize });
  const child = roundTrip('Yes.', { ...render, preset: 'child', recognize });
  assert.deepEqual(male.spoken.head, synthesize('Yes.', render).head);
  assert.ok(
    male.spoken.head.vocalTractLength > child.spoken.head.vocalTractLength
  );
  assert.notDeepEqual(male.spoken.samples, child.spoken.samples);
});

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

it('compares Mandarin pronunciations one character at a time', () => {
  const result = roundTrip('他是中国人。', {
    ...render,
    lang: 'zh',
    recognize: () => ({
      text: '她是中国人。',
      ipa: '',
      languages: [],
      words: [],
    }),
  });
  assert.equal(result.cer.distance, 1);
  assert.equal(result.soundWer.distance, 0);
  assert.equal(result.soundWer.referenceLength, 5);
});

it('counts foreign characters in a Mandarin recognition result', () => {
  const result = roundTrip('他是中国人。', {
    ...render,
    lang: 'zh',
    recognize: () => ({
      text: 'abc她是中国人。',
      ipa: '',
      languages: [],
      words: [],
    }),
  });
  assert.equal(result.soundWer.insertions, 3);
  assert.equal(result.soundWer.distance, 3);
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

it('reports each measured preset and lists reused mode cases once', () => {
  const item = {
    set: 'main',
    lang: 'en',
    tier: 'telephone',
    preset: 'male',
    sentence: 1,
    per: { distance: 1, referenceLength: 4, rate: 0.25 },
    timeErrors: { errors: [], total: 0 },
    stressExpected: 0,
    duration: 1,
    seconds: 0.1,
    text: 'Stop!',
    heardText: 'Stop!',
    referenceIpa: 'stɒp',
    heardIpa: 'stɑp',
  };
  const female = {
    ...item,
    preset: 'female',
    per: { distance: 4, referenceLength: 6, rate: 4 / 6 },
  };
  const whisper = { ...item, set: 'whisper', mode: 'W' };
  const loud = { ...item, set: 'modes', mode: 'f' };
  const groups = [
    { set: 'main', presets: ['male', 'female'], items: [item, female] },
    { set: 'whisper', presets: ['male'], items: [whisper] },
    {
      set: 'modes',
      presets: ['male'],
      items: [{ ...whisper, set: 'modes' }, loud],
    },
  ].map((row) => ({
    ...row,
    lang: item.lang,
    tier: item.tier,
    stats: summarizeRoundTrips(row.items),
    failures: [],
  }));
  const { markdown, data } = roundTripReport(groups, 80, true);
  assert.ok(markdown.includes('| en | telephone | male, female | 2 | 50.0% |'));
  assert.ok(markdown.includes('| en | telephone | male | 1 | 25.0% |'));
  assert.ok(markdown.includes('| en | telephone | female | 1 | 66.7% |'));
  assert.equal(data.worst.length, 4);
  assert.deepEqual(
    data.worst.filter(({ mode }) => mode),
    [whisper, loud]
  );
});
