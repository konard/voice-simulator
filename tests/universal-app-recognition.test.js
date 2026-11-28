import { describe, expect, it } from 'test-anywhere';
import { randomHeadConfig, synthesize, textToIpa } from '../src/index.js';
import { decodeWav, encodeWav } from '../src/audio/wav.js';
import { matchTelephoneRecording } from '../src/recognition/telephone-match.js';
import { fakeRoot } from './helpers/highlight-root.js';
import {
  paintHighlight,
  textPieces,
} from '../examples/universal-app/src/components/highlight.js';
import { recognitionTimeline } from '../examples/universal-app/src/components/recognition-timeline.js';
import { createMicrophone } from '../examples/universal-app/src/engine/microphone.js';
import { verifyFile } from '../examples/universal-app/src/engine/recognition-file.js';
import { RecognitionSession } from '../examples/universal-app/src/engine/recognition-session.js';
import {
  DEFAULT_RECOGNITION_SETTINGS,
  microphoneConstraints,
  noisyInput,
  recognitionOptions,
  DEFAULT_VOICE_SETTINGS,
  voiceOptions,
} from '../examples/universal-app/src/components/settings.js';

const hello = {
  text: 'hello',
  ipa: 'həˈloʊ',
  start: 0,
  end: 0.5,
  language: 'en',
  syllables: [
    { text: 'hel', ipa: 'hə', start: 0, end: 0.2, stress: 0 },
    { text: 'lo', ipa: 'ˈloʊ', start: 0.2, end: 0.5, stress: 1 },
  ],
};
const world = {
  text: 'world',
  ipa: 'ˈwɝld',
  start: 0.5,
  end: 1,
  language: 'en',
};
world.syllables = [{ ...world, stress: 1 }];

function fakeWorker() {
  const messages = [];
  const listeners = new Map();
  return {
    messages,
    postMessage: (message, transfer) => messages.push({ message, transfer }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    emit: (type, payload) =>
      listeners.get('message')({ data: { type, ...payload } }),
    terminate() {},
  };
}

const sampleRate = 16000;
const file = { samples: new Float32Array(16000), sampleRate };

it('replaces streamed word guesses with a complete telephone file reading', () => {
  const { samples, sampleRate } = synthesize('Hello world.', {
    tier: 'telephone',
  });
  const events = [];
  const reading = verifyFile(
    { sampleRate, sampleCount: samples.length, languages: ['en'] },
    (type, payload) => events.push([type, payload.text])
  );
  const middle = Math.floor(samples.length / 2);
  reading.push(samples.subarray(0, middle));
  reading.emit('partial', { text: 'Hello' });
  reading.emit('final', { text: 'Hollow' });
  reading.push(samples.subarray(middle));
  expect(events).toEqual([['partial', 'Hello']]);

  const result = reading.finish({
    flush() {
      throw new Error('Complete telephone recording used the live fallback');
    },
  });
  expect(result.words.map(({ text }) => text.toLowerCase())).toEqual([
    'hello',
    'world',
  ]);
  expect(events.filter(([type]) => type === 'final')).toEqual([
    ['final', result.text],
  ]);
});

it('verifies telephone word corrections against the WAV samples', () => {
  const seed = 'phone-bird';
  const head = randomHeadConfig(seed, { preset: 'any' });
  const language = { lang: 'en', accent: 'en-US', weakForms: true };
  const text = 'The bird flew home.';
  const { ipa } = textToIpa(text, language);
  const rendered = synthesize(ipa, {
    ipa: true,
    lang: language.lang,
    head,
    seed,
    tier: 'telephone',
    engine: 'js',
  });
  const { samples, sampleRate } = decodeWav(
    encodeWav(rendered.samples, rendered.sampleRate)
  );
  const synthesisVoice = { ...language, head, seed };
  const reading = verifyFile(
    { sampleRate, sampleCount: samples.length, synthesisVoice },
    () => {}
  );
  reading.push(samples);
  const result = reading.finish();
  expect(result.text).toBe(text);
  expect(result.words.map(({ confidence }) => confidence)).toEqual([
    1, 1, 1, 1,
  ]);
  expect(
    matchTelephoneRecording(samples, { ...synthesisVoice, seed: 'wrong-seed' })
  ).toBeNull();
});

function fakeContext() {
  const calls = [];
  const node = {
    connect: (to) => calls.push(to),
    disconnect: () => calls.push('disconnected'),
  };
  const stream = {
    getTracks: () => [{ stop: () => calls.push('track stopped') }],
  };
  const context = {
    sampleRate: 16000,
    destination: 'destination',
    createMediaStreamSource: () => node,
    createScriptProcessor: (...args) => {
      calls.push(args);
      return { ...node };
    },
    close: () => calls.push('closed'),
  };
  return { calls, context, stream };
}

describe('recognition timeline', () => {
  it('maps a result to a timeline', () => {
    const { text, timeline } = recognitionTimeline({
      text: 'Hello world.',
      words: [hello, world],
    });
    const offsets = ({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd];
    expect(text).toBe('Hello world.');
    expect(timeline.words.map(offsets)).toEqual([
      [0, 5],
      [6, 11],
    ]);
    expect(timeline.words[0].syllables.map(offsets)).toEqual([
      [0, 3],
      [3, 5],
    ]);
    expect(timeline.words[0].lang).toBe('en');
    expect(timeline.words[0].syllables[1].stress).toBe(1);
    expect(timeline.duration).toBe(1);
  });

  it('marks the newest syllable', () => {
    const { text, timeline } = recognitionTimeline({
      text: 'Hello world.',
      words: [hello, world],
    });
    const root = fakeRoot(textPieces(text, timeline));
    const mark = (speaking) =>
      paintHighlight(root, {
        speaking,
        time: hello.syllables[1].end - 0.001,
        timeline,
        syllableOnlyAria: true,
      });
    mark(true);
    const lit = 'syllable-current';
    expect(root.spans.map((span) => span.classList.contains(lit))).toEqual([
      false,
      true,
      false,
    ]);
    expect(root.spans.map((span) => span.getAttribute('aria-current'))).toEqual(
      [null, 'true', null]
    );
    mark(false);
    expect(root.spans.some((span) => span.classList.contains(lit))).toBe(false);
  });
});

describe('recognition session', () => {
  it('keeps committed words', async () => {
    const worker = fakeWorker();
    const session = new RecognitionSession({ createWorker: () => worker });
    await session.start(file);
    worker.emit('final', {
      text: 'Hello world.',
      words: [hello, world],
      modes: [],
    });
    const committed = session.status.result.words;
    const there = { ...world, text: 'there' };
    worker.emit('partial', { text: 'There', words: [there] });
    expect(session.status.result.text).toBe('Hello world. There');
    expect(session.status.result.words[0]).toBe(committed[0]);
    worker.emit('partial', { text: 'Hello again', words: [hello, world] });
    expect(session.status.result.words[0]).toBe(committed[0]);
    expect(session.status.result.words[1]).toBe(committed[1]);
    expect(session.status.committedWords).toBe(2);
    worker.emit('syllable', { end: 1.6 });
    expect(session.status.lastSyllable).toBe(1.6);
    worker.emit('result', {
      result: { text: 'Hello world.', words: [{ ...hello }, { ...world }] },
    });
    expect(session.status.state).toBe('done');
    expect(session.status.result.words[0]).toBe(committed[0]);
  });

  it('sends a file in 20 ms chunks', async () => {
    const worker = fakeWorker();
    const session = new RecognitionSession({ createWorker: () => worker });
    await session.start(file);
    expect(worker.messages.map(({ message }) => message.type)).toEqual([
      'start',
      'chunk',
    ]);
    for (let i = 0; i < 50; i++) {
      worker.emit('chunk');
    }
    const chunks = worker.messages.filter(
      ({ message }) => message.type === 'chunk'
    );
    expect(chunks.length).toBe(50);
    expect(
      chunks.every(
        ({ message, transfer }) =>
          message.samples.length === 320 &&
          transfer[0] === message.samples.buffer
      )
    ).toBe(true);
    expect(
      worker.messages.filter(({ message }) => message.type === 'stop').length
    ).toBe(1);
    expect(file.samples.length).toBe(16000);
  });

  it('reports a refused permission', async () => {
    const microphone = createMicrophone(
      {},
      {
        getUserMedia: () =>
          Promise.reject(
            new globalThis.DOMException('Denied', 'NotAllowedError')
          ),
      }
    );
    let created = 0;
    const session = new RecognitionSession({
      createWorker() {
        created++;
        return fakeWorker();
      },
    });
    await session.start(microphone);
    expect(session.status.state).toBe('error');
    expect(session.status.error.code).toBe('denied');
    expect(created).toBe(0);
  });

  it('releases the stream if permission arrives after stop', async () => {
    const { calls, context, stream } = fakeContext();
    let grant;
    const microphone = createMicrophone(
      {},
      {
        context,
        getUserMedia: () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      }
    );
    const session = new RecognitionSession();
    const starting = session.start(microphone);
    await Promise.resolve();
    session.stop();
    grant(stream);
    await starting;
    expect(session.status.state).toBe('idle');
    expect(calls).toEqual(['track stopped']);
  });
});

it('validates the recognition worker start options', async () => {
  const messages = [];
  let handle;
  const original = {
    addEventListener: globalThis.addEventListener,
    postMessage: globalThis.postMessage,
  };
  globalThis.addEventListener = (type, callback) => {
    if (type === 'message') {
      handle = (data) => callback({ data });
    }
  };
  globalThis.postMessage = (message) => messages.push(message);
  try {
    await import('../examples/universal-app/src/engine/recognition-worker.js');
    const start = { type: 'start', sampleRate: 16000, id: 1 };
    await handle({ ...start, languages: ['invalid'] });
    await handle({ ...start, languages: ['en'], level: 'invalid' });
    expect(messages.map(({ message }) => message)).toEqual([
      'languages must contain distinct supported codes',
      'level must be auto, low, medium or high',
    ]);
    handle({ ...start, languages: ['en'], level: 'low' });
    await handle({
      type: 'chunk',
      id: start.id,
      samples: new Float32Array(320),
    });
    expect(messages.at(-1)).toEqual({ type: 'chunk', id: start.id });
    await handle({ type: 'stop', id: start.id });
    expect(messages.at(-1).code).toBe('empty');
  } finally {
    Object.assign(globalThis, original);
  }
});

describe('recognition microphone', () => {
  it('falls back without AudioWorklet', async () => {
    const { calls, context, stream } = fakeContext();
    const microphone = createMicrophone(
      {},
      {
        context,
        getUserMedia: async ({ audio }) => {
          expect(audio).toEqual({
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          });
          return stream;
        },
      }
    );
    await microphone.start();
    expect(calls[0]).toEqual([2048, 1, 1]);
    expect(microphone.sampleRate).toBe(16000);
    await microphone.stop();
    expect(calls.slice(-4)).toEqual([
      'track stopped',
      'disconnected',
      'disconnected',
      'closed',
    ]);
  });
});

describe('recognition settings (issue 170)', () => {
  it('sends the settings, the input level and keeps the input', async () => {
    const worker = fakeWorker();
    const session = new RecognitionSession({ createWorker: () => worker });
    const loud = { samples: new Float32Array(3200).fill(0.5), sampleRate };
    const options = recognitionOptions({
      ...DEFAULT_RECOGNITION_SETTINGS,
      decoder: 'phones',
      whisper: false,
      minVoiced: 0,
    });
    expect(options).toEqual({
      level: 'auto',
      decoder: 'phones',
      oov: undefined,
      whisper: false,
      modes: true,
      minVoiced: 0,
    });
    await session.start(loud, options);
    expect(worker.messages[0].message).toEqual({
      type: 'start',
      id: 1,
      sampleRate,
      sampleCount: 3200,
      ...options,
    });
    for (let i = 0; i < 4; i++) {
      worker.emit('chunk', { id: 1 });
    }
    expect(Math.round(session.status.inputLevel)).toBe(-6);
    expect(session.recorded).toBe(true);
    expect(session.recording().samples).toBe(loud.samples);
    await session.start(loud, options, { keep: false });
    expect(session.recorded).toBe(false);
    expect(session.recording()).toBe(null);
  });

  it('keeps the microphone input and opens it with the constraints', async () => {
    const { context, stream } = fakeContext();
    let asked;
    const microphone = createMicrophone(
      {},
      {
        context,
        constraints: { noiseSuppression: true },
        getUserMedia: async (constraints) => {
          asked = constraints.audio;
          return stream;
        },
      }
    );
    const worker = fakeWorker();
    const session = new RecognitionSession({ createWorker: () => worker });
    await session.start(microphone);
    expect(asked).toEqual({
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    });
    expect(
      microphoneConstraints({
        ...DEFAULT_RECOGNITION_SETTINGS,
        autoGainControl: true,
      })
    ).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    });
  });

  it('lays noise over a file at the chosen ratio', () => {
    const tone = new Float32Array(sampleRate);
    for (let i = 0; i < tone.length; i++) {
      tone[i] = 0.1 * Math.sin((2 * Math.PI * 200 * i) / sampleRate);
    }
    const input = { samples: tone, sampleRate };
    expect(noisyInput(input, DEFAULT_RECOGNITION_SETTINGS)).toBe(input);
    const noisy = noisyInput(input, {
      ...DEFAULT_RECOGNITION_SETTINGS,
      noise: 'white',
      snr: 0,
    });
    const rms = (list) =>
      Math.sqrt(list.reduce((sum, x) => sum + x * x, 0) / list.length);
    const noise = noisy.samples.map((value, i) => value - tone[i]);
    expect(Math.abs(20 * Math.log10(rms(tone) / rms(noise))) < 0.5).toBe(true);
    expect(noisy.sampleRate).toBe(sampleRate);
  });

  it('maps the speech settings to the speak request', () => {
    expect(voiceOptions(DEFAULT_VOICE_SETTINGS)).toEqual({
      weakForms: true,
      breaths: false,
      source: 'lf',
      interaction: undefined,
      subglottal: undefined,
      headroom: undefined,
    });
    expect(
      voiceOptions({
        ...DEFAULT_VOICE_SETTINGS,
        source: 'folds',
        interaction: true,
        subglottal: false,
        headroom: 6,
      })
    ).toEqual({
      weakForms: true,
      breaths: false,
      source: 'folds',
      interaction: true,
      subglottal: false,
      headroom: 6,
    });
  });
});
