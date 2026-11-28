import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  createRecognizer,
  DEFAULT_HEAD,
  levelForTier,
  recognize,
  RecognitionError,
  RECOGNITION_LEVELS,
  synthesize,
} from '../src/index.js';
import { createRandom } from '../src/random.js';

const KEYS = ['ipa', 'text', 'languages', 'words', 'modes', 'voice'];
const WORD_KEYS = [
  'text',
  'ipa',
  'language',
  'start',
  'end',
  'confidence',
  'syllables',
];
const RATE = 16000;
const IPA = 'həloʊ';
const TIMED = [{ ipa: IPA, start: 0.1, end: 0.4, confidence: 0.8 }];
const SYLLABLE = {
  text: 'hel',
  ipa: 'hə',
  start: 0.1,
  end: 0.2,
  stress: 0,
};
const WORD = {
  text: 'hello',
  ipa: IPA,
  language: 'en',
  start: 0.1,
  end: 0.4,
  confidence: 0.8,
  syllables: [SYLLABLE],
};
const STREAM_OPTIONS = {
  languages: ['en'],
  voice: DEFAULT_HEAD,
  modes: false,
  level: 'low',
  stages: {
    identifyLanguage: () => assert.fail('one language skips identification'),
    ipaToText: () => ({ text: WORD.text, ipa: WORD.ipa, words: [WORD] }),
  },
};
const OPTIONS = {
  ...STREAM_OPTIONS,
  stages: {
    ...STREAM_OPTIONS.stages,
    audioToIpa: () => ({ ipa: IPA, segments: TIMED }),
  },
};

it('returns the fixed result shape', () => {
  const result = recognize(new Float32Array(RATE), RATE, OPTIONS);
  assert.deepEqual(Object.keys(result), KEYS);
  assert.deepEqual(Object.keys(result.words[0]), WORD_KEYS);
  assert.deepEqual(result.languages, [{ language: 'en', share: 1 }]);
  assert.deepEqual(result.words[0].syllables, [SYLLABLE]);
  assert.deepEqual(result.modes, []);
  assert.equal(result.voice, null);
});

it('includes timed phonemes only when requested', () => {
  const segments = [
    { ipa: 'h', start: 0.1, end: 0.15, confidence: 0.8 },
    { ipa: '', start: 0.15, end: 0.2, confidence: 1, kind: 'pause' },
    { ipa: 'ə', start: 0.2, end: 0.4, confidence: 0.7 },
  ];
  const options = {
    ...OPTIONS,
    segments: true,
    stages: { ...OPTIONS.stages, audioToIpa: () => ({ ipa: IPA, segments }) },
  };
  const samples = new Float32Array(RATE / 2);
  const batch = recognize(samples, RATE, options);
  const { events, result } = capture(samples, 1024, options);
  const expected = [segments[0], segments[2]];
  assert.deepEqual(Object.keys(batch), [...KEYS, 'segments']);
  assert.deepEqual(batch.segments, expected);
  assert.deepEqual(result.segments, expected);
  assert.deepEqual(
    events.find(({ type }) => type === 'final')?.event.segments,
    expected
  );
});

it('uses the level rate, hop and beam and forwards spans and alternatives', () => {
  const spans = [{ language: 'en', from: 0, to: 4 }];
  const alternatives = [
    { text: 'high', ipa: 'haɪ', confidence: 0.1 },
    { text: 'hey', ipa: 'heɪ', confidence: 0.9 },
  ];
  const result = recognize(new Float32Array(RATE), RATE, {
    ...OPTIONS,
    languages: ['en', 'ru'],
    nbest: 2,
    stages: {
      audioToIpa(samples, rate, options) {
        assert.equal(rate, 8000);
        assert.equal(samples.length, 8000);
        assert.equal(options.voice, DEFAULT_HEAD);
        assert.equal(options.nbest, 2);
        assert.equal(options.hop, 0.01);
        assert.equal(options.beam, 8);
        return { ipa: IPA, segments: TIMED };
      },
      identifyLanguage(phones, options) {
        assert.deepEqual(phones, TIMED);
        assert.deepEqual(options.languages, ['en', 'ru']);
        return { spans };
      },
      ipaToText(phones, options) {
        assert.deepEqual(phones, TIMED);
        assert.equal(options.spans, spans);
        return { text: WORD.text, ipa: WORD.ipa, words: [WORD], alternatives };
      },
    },
  });
  assert.deepEqual(result.alternatives, [alternatives[1]]);
  assert.ok(
    Object.isFrozen(RECOGNITION_LEVELS) &&
      Object.values(RECOGNITION_LEVELS).every(Object.isFrozen)
  );
  assert.deepEqual(
    [
      'telephone',
      'narrowband',
      'wideband',
      'minimal',
      'low',
      'studio',
      'unknown',
    ].map(levelForTier),
    ['low', 'low', 'medium', 'medium', 'medium', 'high', 'high']
  );
});

it('rejects empty and invalid input', () => {
  assert.throws(() => recognize([], RATE), {
    name: 'RecognitionError',
    code: 'empty',
  });
  assert.throws(() => recognize([], 4000), RangeError);
  assert.throws(() => recognize([NaN], RATE), RangeError);
  const random = createRandom(73);
  const noise = Float32Array.from(
    { length: RATE * 2 },
    () => 0.4 * (random() - 0.5)
  );
  assert.throws(() => recognize(noise, RATE, { level: 'low' }), {
    name: 'RecognitionError',
    code: 'too-noisy',
  });
});

it('returns the empty result for silence', () => {
  assert.deepEqual(recognize(new Float32Array(RATE), RATE), {
    ipa: '',
    text: '',
    languages: [],
    words: [],
    modes: [],
    voice: null,
  });
});

function samplePhrase(rate) {
  return synthesize('A little bird sings.', {
    lang: 'en',
    tier: 'telephone',
    sampleRate: rate,
    seed: 1,
  }).samples;
}

it('passes measured prosody into text recognition when modes are enabled', () => {
  const sampleRate = 8000;
  const options = {
    languages: ['en'],
    level: 'low',
    stages: {
      ipaToText(phones) {
        assert.ok(phones.some(({ prominence }) => Number.isFinite(prominence)));
        return { text: WORD.text, ipa: WORD.ipa, words: [WORD] };
      },
    },
  };
  const result = recognize(samplePhrase(sampleRate), sampleRate, options);
  assert.match(result.text, /^Hello/u);
  assert.deepEqual(Object.keys(result.words[0]), WORD_KEYS);
});

function capture(
  signal,
  chunkSize,
  options = STREAM_OPTIONS,
  sampleRate = RATE
) {
  const stream = createRecognizer({ ...options, sampleRate });
  const events = [];
  let pushed = 0;
  for (const type of ['partial', 'syllable', 'final']) {
    stream.on(type, (event) =>
      events.push({
        type,
        event,
        pushed,
        original: globalThis.structuredClone(event),
      })
    );
  }
  const errors = [];
  stream.on('error', (failure) => errors.push(failure));
  for (let i = 0; i < signal.length; i += chunkSize) {
    const chunk = signal.subarray(i, i + chunkSize);
    pushed = (i + chunk.length) / sampleRate;
    stream.push(chunk);
  }
  const result = stream.flush();
  assert.deepEqual(errors, []);
  return { events, result };
}

it('streams the same words as one call with 1024-sample chunks', () => {
  const signal = new Float32Array(4 * RATE);
  signal.set(samplePhrase(RATE));
  const { events, result } = capture(signal, 1024);
  const finals = events.filter(({ type }) => type === 'final');
  assert.equal(finals.length, 1);
  const batch = recognize(signal, RATE, OPTIONS);
  assert.deepEqual(
    finals.flatMap(({ event }) => event.words),
    batch.words
  );
  assert.deepEqual(result.words, batch.words);
});

it('uses the supplied IPA stage for stream partials and finals', () => {
  const snapshots = [];
  const options = {
    ...OPTIONS,
    stages: {
      ...OPTIONS.stages,
      audioToIpa(samples, rate, options) {
        assert.equal(rate, 8000);
        assert.equal(options.voice, DEFAULT_HEAD);
        assert.equal(options.nbest, 1);
        snapshots.push(samples.length / rate);
        return snapshots.at(-1) >= 0.4
          ? { ipa: IPA, segments: TIMED }
          : { ipa: '' };
      },
    },
  };
  const { events, result } = capture(new Float32Array(RATE / 2), 1024, options);
  assert.deepEqual(snapshots, [0.25, 0.5, 0.5]);
  assert.deepEqual(
    events.map(({ type }) => type),
    ['partial', 'partial', 'final']
  );
  assert.equal(events[1].event.text, WORD.text);
  assert.deepEqual(result.words, [WORD]);
});

it('can skip interim readings and still read the final phrase', () => {
  const snapshots = [];
  const stream = createRecognizer(
    {
      ...OPTIONS,
      sampleRate: RATE,
      stages: {
        ...OPTIONS.stages,
        audioToIpa(samples, rate) {
          snapshots.push(samples.length / rate);
          return { ipa: IPA, segments: TIMED };
        },
      },
    },
    { previews: false }
  );
  stream.on('partial', () => assert.fail('unexpected interim reading'));
  stream.push(new Float32Array(RATE / 2));
  assert.deepEqual(stream.flush().words, [WORD]);
  assert.deepEqual(snapshots, [0.5]);
});

for (const sampleRate of [8000, 16000]) {
  it(`keeps final readings at ${sampleRate} Hz with the acoustic speech gate`, () => {
    const phrase = samplePhrase(sampleRate);
    const signal = new Float32Array(2 * (phrase.length + sampleRate / 2));
    signal.set(phrase);
    signal.set(phrase, signal.length / 2);
    const options = {
      sampleRate,
      languages: ['en'],
      voice: DEFAULT_HEAD,
      modes: false,
      level: 'medium',
      deterministic: true,
      segments: true,
    };
    const read = (live) => {
      const stream = createRecognizer(options, live);
      const finals = [];
      stream.on('final', (reading) => finals.push(reading));
      stream.push(signal);
      return { result: stream.flush(), finals };
    };
    const previous = read({ previews: false });
    assert.equal(previous.finals.length, 2);
    assert.ok(previous.result.words.length);
    assert.deepEqual(read({ finalOnly: true }), previous);
  });
}

it('never changes committed words or takes a syllable back', () => {
  const signal = new Float32Array(4 * RATE);
  const phrase = samplePhrase(RATE);
  signal.set(phrase);
  signal.set(phrase, 2 * RATE);
  const { events, result } = capture(signal, 512);
  const finals = events.filter(({ type }) => type === 'final');
  const nuclei = events.filter(({ type }) => type === 'syllable');
  assert.equal(finals.length, 2);
  assert.ok(nuclei.length >= 2);
  assert.deepEqual(
    nuclei.map(({ event }) => event.index),
    nuclei.map((_, i) => i)
  );
  for (const { event, original } of events) {
    assert.deepEqual(event, original);
  }
  const words = finals.flatMap(({ event }) => event.words);
  assert.deepEqual(words, result.words);
  assert.ok(words[0].end < words[1].start);
});

it('commits a long phrase at a word boundary at least one second old', () => {
  const sampleRate = 8000;
  const { samples } = synthesize(
    'A little bird sings while a swift swallow flies and a clever raven calls through the night',
    { lang: 'en', tier: 'telephone', seed: 1 }
  );
  assert.ok(samples.length > 6 * sampleRate);
  const { events, result } = capture(
    samples,
    160,
    { languages: ['en'], level: 'low', modes: false },
    sampleRate
  );
  const finals = events.filter(({ type }) => type === 'final');
  const [first] = finals;
  assert.ok(first && first.pushed > 5 && first.pushed < 5.25);
  assert.ok(first.event.words.at(-1).end <= first.pushed - 1);
  assert.deepEqual(
    result.words,
    finals.flatMap(({ event }) => event.words)
  );
});

it('keeps fixed IPA in live syllable events at 8 kHz', () => {
  const sampleRate = 8000;
  const { samples } = synthesize('Hello world.', {
    lang: 'en',
    tier: 'telephone',
    seed: 1,
  });
  const signal = samples.subarray(0, sampleRate / 5);
  const options = { languages: ['en'], level: 'low', modes: false };
  const syllables = (decoder) =>
    capture(signal, 160, { ...options, decoder }, sampleRate)
      .events.filter(({ type }) => type === 'syllable')
      .map(({ event }) => event);
  const expected = syllables('phones');
  assert.ok(expected.some(({ ipa }) => ipa));
  assert.deepEqual(syllables('words'), expected);
});

it('reports a syllable within 200 ms and gives the first partial within 500 ms', () => {
  const { events } = capture(samplePhrase(RATE), 320);
  const nuclei = events.filter(({ type }) => type === 'syllable');
  const voicedPartial = events.find(
    ({ type, event }) => type === 'partial' && event.text
  );
  assert.ok(nuclei.length > 0);
  for (const { event, pushed } of nuclei) {
    assert.ok(
      pushed <= event.end + 0.2,
      `Syllable delay: ${pushed - event.end}s`
    );
  }
  assert.ok(voicedPartial && voicedPartial.pushed < nuclei[0].event.end + 0.5);
});

it('emits push errors, supports unsubscribing and starts over after reset', () => {
  const stream = createRecognizer({ sampleRate: RATE });
  const errors = [];
  const listen = (error) => errors.push(error);
  stream.on('error', listen);
  assert.doesNotThrow(() => stream.push(Float32Array.of(Infinity)));
  assert.ok(errors[0] instanceof RangeError);
  stream.off('error', listen);
  stream.reset();
  stream.push(new Float32Array(RATE / 4));
  assert.equal(stream.flush().text, '');
  assert.throws(() => {
    stream.reset();
    stream.flush();
  }, RecognitionError);
  assert.equal(errors.length, 1);
});

it('recognises its own speech', () => {
  const { samples, sampleRate } = synthesize('Hello world.', {
    lang: 'en',
    tier: 'minimal',
    seed: 1,
  });
  const result = recognize(samples, sampleRate);
  assert.equal(
    result.text.toLowerCase().replaceAll(/\p{P}/gu, ''),
    'hello world'
  );
});

it('recovers a different simulated pronunciation and its word times', () => {
  const { samples, sampleRate, timeline } = synthesize('Good morning.', {
    lang: 'en',
    tier: 'minimal',
    seed: 1,
  });
  const { words } = recognize(samples, sampleRate, { languages: ['en'] });
  assert.deepEqual(
    words.map(({ text }) => text.toLowerCase()),
    ['good', 'morning']
  );
  for (const [index, word] of words.entries()) {
    assert.ok(Math.abs(word.start - timeline.words[index].start) < 0.01);
    assert.ok(Math.abs(word.end - timeline.words[index].end) < 0.01);
  }
});

it('runs faster than real time', () => {
  const sampleRate = 8000;
  const samples = samplePhrase(sampleRate);
  const signal = new Float32Array(10 * sampleRate);
  for (
    let i = 0;
    i + samples.length < signal.length;
    i += samples.length + sampleRate / 2
  ) {
    signal.set(samples, i);
  }
  // Exclude shared pronunciation and acoustic model initialization from throughput.
  const options = { level: 'low' };
  recognize(samples, sampleRate, options);
  const start = globalThis.performance.now();
  const result = recognize(signal, sampleRate, options);
  const elapsed = (globalThis.performance.now() - start) / 1000;
  console.log(`Level low, 10 seconds at 8000 Hz: ${elapsed.toFixed(3)} s`);
  assert.ok(result.words.length > 0);
  assert.ok(elapsed < 5, `Recognition took ${elapsed.toFixed(3)} s`);
});
