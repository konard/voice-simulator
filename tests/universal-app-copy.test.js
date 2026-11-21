import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import { describe, expect, it } from 'test-anywhere';
import {
  CopySession,
  canSave,
} from '../examples/universal-app/src/engine/copy-session.js';
import { createSessionHost } from '../examples/universal-app/src/engine/session-worker.js';
import { loadVoice } from '../src/index.js';
import { COPY_RATE, copyFixture, female } from './helpers/copy-app-fixture.js';
import { checkBlockedGate } from './helpers/blocked-gate.js';

class FakeWorker {
  sent = [];
  listeners = new Map();
  terminated = false;

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message, transfer = []) {
    this.sent.push({ message, transfer });
  }

  emit(data) {
    this.listeners.get('message')({ data });
  }

  terminate() {
    this.terminated = true;
  }

  messages(type) {
    return this.sent
      .map(({ message }) => message)
      .filter((message) => message.type === type);
  }
}

function fakeSession() {
  const worker = new FakeWorker();
  return { session: new CopySession({ createWorker: () => worker }), worker };
}

function emitVoice(worker, changes = {}) {
  worker.emit({ type: 'voice', voice: female, changes, converged: false });
}

describe('voice copy worker', () => {
  const messages = [];
  const host = createSessionHost({
    post: (event, transfers) => messages.push({ event, transfers }),
  });
  let captured;
  async function capture() {
    const now = performance.now();
    const samples = copyFixture(8);
    await host.handle({
      type: 'start',
      sampleRate: COPY_RATE,
      languages: ['en'],
      level: 'low',
    });
    for (let i = 0; i < samples.length; i += 320) {
      await host.handle({
        type: 'chunk',
        samples: samples.subarray(i, i + 320),
        acknowledge: i === 0,
      });
    }
    await host.handle({ type: 'stop' });
    return performance.now() - now;
  }

  it('reaches a stable voice from a fake microphone', async () => {
    captured ??= capture();
    const elapsed = await captured;
    const states = messages
      .filter(({ event }) => event.type === 'state')
      .map(({ event }) => event.state);
    const lastVoice = messages.findLast(
      ({ event }) => event.type === 'voice'
    )?.event;
    const { head } = loadVoice(lastVoice.voice);
    expect(Math.abs(head.pitch / female.pitch - 1)).toBeLessThanOrEqual(0.05);
    expect(
      Math.abs(head.vocalTractLength / female.vocalTractLength - 1)
    ).toBeLessThanOrEqual(0.08);
    expect(messages.filter(({ event }) => event.type === 'load').length).toBe(
      8
    );
    expect(messages.filter(({ event }) => event.type === 'chunk').length).toBe(
      1
    );
    const required = [
      'collecting',
      'fitting',
      'inverting',
      'refining',
      'stable',
    ];
    checkBlockedGate({
      criterion:
        'the real voice session settles on the female fixture within 30 seconds',
      passed:
        states
          .filter((state, index) => state !== states[index - 1])
          .join(',') === required.join(',') && elapsed < 30_000,
      measured: `${states.join(' → ')} in ${(elapsed / 1000).toFixed(2)} s`,
      action:
        'Resolve the inversion confidence and convergence gap recorded in docs/reports/issue-78-validation.md.',
    });
  });

  it('repeats what was said', async () => {
    captured ??= capture();
    await captured;
    const final = messages.findLast(
      ({ event }) => event.type === 'final' && event.words.length
    ).event;
    const duration = final.words.at(-1).end - final.words[0].start;
    await host.handle({ type: 'repeat', id: 9, tier: 'minimal' });
    const replies = messages.filter(({ event }) => event.type === 'audio');
    expect(replies.length).toBe(1);
    const [{ event, transfers }] = replies;
    expect(event.id).toBe(9);
    expect(transfers[0]).toBe(event.samples.buffer);
    expect(
      Math.abs(event.samples.length / event.sampleRate / duration - 1)
    ).toBeLessThanOrEqual(0.2);
  });
});

describe('voice copy controller', () => {
  it('pauses the fits when overloaded and uses the measured device tier', async () => {
    const { session, worker } = fakeSession();
    await session.start(
      { samples: new Float32Array(321), sampleRate: COPY_RATE },
      { tier: 'telephone' }
    );
    expect(worker.messages('start')[0].level).toBe('low');
    worker.emit({ type: 'load', load: 0.9 });
    expect(worker.messages('share')).toEqual([]);
    worker.emit({ type: 'load', load: 0.9 });
    expect(session.status.overloaded).toBe(true);
    worker.emit({ type: 'load', load: 0.4 });
    expect(worker.messages('share')).toEqual([{ type: 'share', value: 0 }]);
    worker.emit({ type: 'chunk' });
    expect(
      worker.messages('chunk').map(({ samples }) => samples.length)
    ).toEqual([320, 1]);
    expect(
      worker.messages('chunk').every(({ acknowledge }) => acknowledge)
    ).toBe(true);
    worker.emit({ type: 'load', load: 0.4 });
    expect(worker.messages('share')).toEqual([
      { type: 'share', value: 0 },
      { type: 'share', value: 0.25 },
    ]);
    expect(session.status.overloaded).toBe(false);
    worker.emit({ type: 'chunk' });
    expect(worker.messages('stop')).toEqual([{ type: 'stop' }]);
    worker.emit({ type: 'stopped' });
    expect(session.status.active).toBe(false);
  });

  it('computes stability and resets the fit for a different speaker', async () => {
    const { session, worker } = fakeSession();
    await session.start({ samples: new Float32Array(), sampleRate: COPY_RATE });
    expect(worker.messages('start')[0].level).toBe('auto');
    expect(session.status.stability).toBe(0);
    emitVoice(worker, { pitch: 0.01, vocalTractLength: 0.02 });
    expect(session.status.stability).toBe(0.8);
    worker.emit({
      type: 'state',
      state: 'collecting',
      reason: 'speaker-change',
      voicedSeconds: 0,
    });
    expect(session.status.voice).toBe(null);
    expect(session.status.stability).toBe(0);
  });

  it('transfers microphone samples and rejects pending playback on reset', async () => {
    const { session, worker } = fakeSession();
    const samples = new Float32Array(321).fill(0.75);
    let stops = 0;
    await session.start({
      start: ({ onChunk }) => {
        onChunk(samples.subarray(0, 128), COPY_RATE);
        onChunk(samples.subarray(128), COPY_RATE);
      },
      stop: () => {
        stops++;
      },
    });
    const [first] = worker.messages('chunk');
    expect(first.acknowledge).toBe(undefined);
    expect(first.samples.length).toBe(320);
    expect(first.samples[319]).toBe(0.75);
    expect(worker.sent[1].transfer).toEqual([first.samples.buffer]);
    session.stop();
    expect(worker.messages('chunk')[1].samples.length).toBe(1);
    expect(worker.messages('chunk')[1].samples[0]).toBe(0.75);
    emitVoice(worker);
    const playback = session.speak('Hello', 'en');
    const abort = playback.catch((error) => error.name);
    const [{ text, lang }] = worker.messages('speak');
    expect({ text, lang }).toEqual({ text: 'Hello', lang: 'en' });
    session.reset();
    expect(await abort).toBe('AbortError');
    expect(stops).toBe(1);
    expect(worker.terminated).toBe(true);
    worker.emit({ type: 'error', message: 'stale' });
    expect(session.status.state).toBe('idle');
  });

  it('asks for consent before saving', () => {
    expect(canSave({ voice: female }, false)).toBe(false);
    expect(canSave({ voice: null }, true)).toBe(false);
    expect(canSave({ voice: female }, true)).toBe(true);
  });

  it('sends no audio to the network', () => {
    for (const path of [
      'engine/session-worker.js',
      'engine/copy-session.js',
      'components/VoiceCopy.js',
    ]) {
      const source = readFileSync(
        new URL(`../examples/universal-app/src/${path}`, import.meta.url),
        'utf8'
      );
      expect(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(source)).toBe(
        false
      );
    }
  });
});
