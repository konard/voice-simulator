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

it('rejects a marked benchmark case when the plan lacks the expected mode', () => {
  const recognize = () => ({ text: '', ipa: '', languages: [], words: [] });
  assert.throws(
    () => roundTrip('Yes.', { ...render, mode: 'W', recognize }),
    /no planned W span/u
  );
});

it('counts a recognition span with the expected mode and half the duration', () => {
  const text = '[whisper]Yes.[/whisper]';
  const { plan } = synthesize(text, { ...render, markup: true });
  const { start, end } = plan.modes.find(
    (span) => span.phonation.whisper === 1
  );
  const result = roundTrip(text, {
    ...render,
    mode: 'W',
    referenceText: 'Yes.',
    recognize: () => ({
      text: 'Yes.',
      ipa: '',
      languages: [],
      words: [],
      modes: [{ start, end: start + (end - start) * 0.5, notation: 'W' }],
    }),
  });
  assert.deepEqual(result.modeSpans, [
    {
      start,
      end,
      label: 'W',
      matched: true,
      lane: 'audio-only',
      scoring: 'overlap',
    },
  ]);
});

// Issue 168: the audio-only lane scores loudness relative to the same voice.
const relativeText =
  '<speak>Yes, I will. <prosody volume="loud">Yes, I will.</prosody></speak>';

function loudSpan(text) {
  const spoken = synthesize(text, { ...render, markup: true });
  const span = spoken.plan.modes.find((mode) => mode.effort > 0.5);
  return { spoken, span, first: spoken.timeline.words[0].start };
}

function heardModes(modes) {
  return () => ({ text: '', ipa: '', languages: [], words: [], modes });
}

it('scores an audio-only effort rise over the neutral span before it', () => {
  const { spoken, span, first } = loudSpan(relativeText);
  const options = {
    ...render,
    spoken,
    mode: 'f',
    modeScoring: 'relative',
    referenceText: 'Yes, I will. Yes, I will.',
  };
  const raised = roundTrip(relativeText, {
    ...options,
    recognize: (_, rate, recognition) => {
      assert.deepEqual(recognition, { level: 'low' });
      return heardModes([
        {
          start: first,
          end: span.start,
          notation: null,
          emotion: { arousal: -0.1 },
        },
        { ...span, notation: null, emotion: { arousal: 0.4 } },
      ])();
    },
  });
  const [scored] = raised.modeSpans;
  assert.equal(scored.lane, 'audio-only');
  assert.equal(scored.scoring, 'relative');
  assert.deepEqual(scored.neutral, { start: first, end: span.start });
  assert.ok(Math.abs(scored.rise - 0.5) < 1e-9);
  assert.equal(scored.matched, true);
  // The same arousal over both spans is no event.
  const flat = roundTrip(relativeText, {
    ...options,
    recognize: heardModes([
      {
        start: first,
        end: span.end,
        notation: null,
        emotion: { arousal: 0.4 },
      },
    ]),
  });
  assert.ok(Math.abs(flat.modeSpans[0].rise) < 1e-9);
  assert.equal(flat.modeSpans[0].matched, false);
  // A relative case needs neutral speech before the loud span.
  const whole = loudSpan(
    '<speak><prosody volume="loud">Yes, I will.</prosody></speak>'
  );
  assert.throws(
    () =>
      roundTrip('', {
        ...options,
        spoken: whole.spoken,
        recognize: heardModes([]),
      }),
    /no neutral span before f/u
  );
});

it('fails the audio-only control on any effort label over a whole loud span', () => {
  const text = '<speak><prosody volume="loud">Yes, I will.</prosody></speak>';
  const { spoken, span } = loudSpan(text);
  const options = { ...render, spoken, mode: 'f', modeScoring: 'absent' };
  const quiet = roundTrip(text, {
    ...options,
    recognize: heardModes([
      { ...span, notation: null, emotion: { arousal: 0.6 } },
    ]),
  });
  assert.deepEqual(quiet.modeSpans, [
    {
      start: span.start,
      end: span.end,
      label: 'f',
      unexpected: [],
      matched: true,
      lane: 'audio-only',
      scoring: 'absent',
    },
  ]);
  const guessed = roundTrip(text, {
    ...options,
    recognize: heardModes([
      { start: span.end - 0.05, end: span.end + 0.1, notation: 'p' },
    ]),
  });
  assert.deepEqual(guessed.modeSpans[0].unexpected, ['p']);
  assert.equal(guessed.modeSpans[0].matched, false);
});

it('passes the voice to the calibrated lane', () => {
  const text = '<speak><prosody volume="loud">Yes, I will.</prosody></speak>';
  const { spoken, span } = loudSpan(text);
  const result = roundTrip(text, {
    ...render,
    spoken,
    mode: 'f',
    knownVoice: true,
    recognize: (_, rate, recognition) => {
      assert.equal(recognition.voice, spoken.head);
      return heardModes([{ ...span, notation: 'f' }])();
    },
  });
  assert.equal(result.modeSpans[0].lane, 'calibrated');
  assert.equal(result.modeSpans[0].matched, true);
});

it('keeps mode-only items out of the round-trip metrics and reports the lanes', () => {
  const base = {
    set: 'modes',
    lang: 'en',
    tier: 'telephone',
    preset: 'male',
    sentence: 1,
    timeErrors: { errors: [], total: 0 },
    stressExpected: 0,
    duration: 1,
    seconds: 0.1,
    languageRight: true,
    text: 'Yes.',
    heardText: 'Yes.',
    referenceIpa: 'jɛs',
    heardIpa: 'jɛs',
  };
  const span = (lane, scoring, matched, extra) => ({
    start: 0,
    end: 1,
    label: 'f',
    matched,
    lane,
    scoring,
    ...extra,
  });
  const items = [
    {
      ...base,
      mode: 'f relative',
      per: { distance: 0, referenceLength: 4, rate: 0 },
      modeSpans: [span('audio-only', 'relative', true, { rise: 0.61 })],
    },
    {
      ...base,
      mode: 'f control',
      per: { distance: 1, referenceLength: 4, rate: 0.25 },
      modeSpans: [span('audio-only', 'absent', false, { unexpected: ['f'] })],
    },
    {
      ...base,
      mode: 'f calibrated',
      modeOnly: true,
      languageRight: false,
      seconds: 10,
      per: { distance: 4, referenceLength: 4, rate: 1 },
      modeSpans: [span('calibrated', 'overlap', false)],
    },
  ];
  const stats = summarizeRoundTrips(items);
  assert.equal(stats.per.rate, 1 / 8);
  assert.equal(stats.language, 1);
  assert.equal(stats.rtf, 0.1);
  assert.equal(stats.modes, 0.5);
  assert.equal(stats.modeCount, 2);
  assert.equal(stats.unexpectedEffort, 1);
  assert.equal(stats.controlCount, 1);
  assert.equal(summarizeRoundTrips(items.slice(0, 1)).unexpectedEffort, null);
  const groups = [
    { lang: 'en', diagnostic: true },
    { lang: 'all', diagnostic: false },
  ].map((row) => ({
    ...row,
    set: 'modes',
    tier: 'telephone',
    presets: ['male'],
    items,
    stats,
    failures: [],
  }));
  const { markdown, data } = roundTripReport(groups, 80, true);
  assert.ok(markdown.includes('## Mode lanes'));
  assert.ok(
    markdown.includes(
      '| telephone | audio-only | f | heard arousal rise ≥ 0.3 over the neutral span | 1/1 (+0.61) | – | – | – | 1/1 |'
    )
  );
  assert.ok(
    markdown.includes(
      '| telephone | audio-only | f | no effort label (negative control) | 0/1 | – | – | – | 0/1 |'
    )
  );
  assert.ok(
    markdown.includes(
      '| telephone | calibrated | f | label over half the span | 0/1 | – | – | – | 0/1 |'
    )
  );
  assert.deepEqual(
    data.worst.map(({ mode }) => mode),
    ['f control', 'f relative']
  );
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
