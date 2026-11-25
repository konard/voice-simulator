/**
 * Issue 170: the streaming recognizer of a live microphone reads phrases
 * with the word decoder, like recognize(), and gives no text for noise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  createNoise,
  createRecognizer,
  recognize,
  synthesize,
} from '../src/index.js';

const RATE = 8000;
const OPTIONS = { languages: ['en'], level: 'low', modes: false };

function stream(samples, options = {}) {
  const recognizer = createRecognizer({
    ...OPTIONS,
    ...options,
    sampleRate: RATE,
  });
  const events = [];
  for (const type of ['partial', 'final', 'error']) {
    recognizer.on(type, (event) => events.push({ type, event }));
  }
  for (let i = 0; i < samples.length; i += 128) {
    recognizer.push(samples.subarray(i, i + 128));
  }
  return { events, result: recognizer.flush() };
}

describe('live recognition in noise (issue 170)', () => {
  it('commits the words recognize() hears in the same audio', () => {
    const { samples, sampleRate } = synthesize('Hello hello hello.', {
      lang: 'en',
      tier: 'telephone',
      seed: 1,
    });
    assert.equal(sampleRate, RATE);
    const padded = new Float32Array(samples.length + RATE);
    padded.set(samples, RATE / 2);
    const batch = recognize(padded, RATE, OPTIONS);
    const { events, result } = stream(padded);
    assert.ok(batch.words.length >= 3, batch.text);
    assert.equal(result.text, batch.text);
    assert.deepEqual(
      events
        .filter(({ type }) => type === 'final')
        .flatMap(({ event }) => event.words.map(({ text }) => text)),
      batch.words.map(({ text }) => text)
    );
  });

  it('gives no text for a room noise of drifting level', () => {
    const noise = createNoise('drifting', 2 * RATE, RATE, {
      seed: 5,
      level: -45,
    });
    const { events, result } = stream(noise);
    assert.deepEqual(
      events.filter(({ type, event }) => type !== 'partial' || event.text),
      []
    );
    assert.deepEqual(result.words, []);
    assert.equal(result.text, '');
    // Without the speech gate the same noise read as strings of fricatives.
    const ungated = stream(noise, { minVoiced: 0 });
    assert.ok(ungated.result.words.length > 0);
  });

  it('gates batch recognition only when asked', () => {
    const noise = createNoise('drifting', 2 * RATE, RATE, {
      seed: 5,
      level: -45,
    });
    assert.deepEqual(
      recognize(noise, RATE, { ...OPTIONS, minVoiced: 0.1 }).words,
      []
    );
    assert.throws(
      () => recognize(noise, RATE, { ...OPTIONS, minVoiced: -1 }),
      /minVoiced/
    );
  });
});
