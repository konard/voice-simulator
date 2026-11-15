/**
 * Issue 9: after the app tab was in the background for a while there was no
 * more sound. Browsers suspend or interrupt the AudioContext of hidden tabs
 * (Safari reports the non-standard state 'interrupted'), and the player only
 * resumed a 'suspended' context, so the context stayed silent and the
 * animation clock, which follows the audio clock, froze with it.
 *
 * Every case runs on AudioPlayer and on WorkletPlayer (issue 27), which
 * falls back to AudioPlayer's buffer sources on a context without
 * AudioWorklet such as FakeContext.
 */

import { describe, it, expect } from 'test-anywhere';
import { AudioPlayer } from '../examples/universal-app/src/engine/audio-player.js';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';
import { WorkletPlayer } from '../examples/universal-app/src/engine/worklet-player.js';

/** Minimal Web Audio context: `currentTime` only moves while running. */
class FakeContext {
  static created = [];

  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.started = [];
    this.resumes = 0;
    // 'grant' resumes, 'hang' never settles (no user gesture yet).
    this.resumeMode = 'grant';
    this.listeners = new Map();
    FakeContext.created.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setState(state) {
    this.state = state;
    this.listeners.get('statechange')?.();
  }

  advance(seconds) {
    if (this.state === 'running') {
      this.currentTime += seconds;
    }
  }

  resume() {
    this.resumes++;
    if (this.resumeMode === 'hang') {
      return new Promise(() => {});
    }
    this.setState('running');
    return Promise.resolve();
  }

  close() {
    this.setState('closed');
    return Promise.resolve();
  }

  createBuffer(channels, length, sampleRate) {
    return { length, sampleRate, copyToChannel() {} };
  }

  createBufferSource() {
    const context = this;
    return {
      connect() {},
      start(when) {
        context.started.push(when);
      },
      stop() {},
    };
  }
}

/** Window and document stand-ins that record their event listeners. */
function fakePage() {
  const listeners = [];
  const target = () => ({
    addEventListener(type, listener) {
      listeners.push({ type, listener });
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener
      );
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
  });
  const document = { ...target(), visibilityState: 'visible' };
  return {
    window: target(),
    document,
    listeners,
    fire(type) {
      for (const entry of listeners.filter((item) => item.type === type)) {
        entry.listener();
      }
    },
  };
}

function makePlayer(Player, options = {}) {
  FakeContext.created = [];
  return new Player({
    createContext: () => new FakeContext(),
    resumeTimeout: 20,
    ...options,
  });
}

for (const Player of [AudioPlayer, WorkletPlayer]) {
  const player = (options) => makePlayer(Player, options);

  describe(`audio after the tab was in the background (${Player.name})`, () => {
    it('resumes an interrupted context when speaking again', async () => {
      const audio = player();
      const context = await audio.unlock();
      context.setState('interrupted');
      const again = await audio.unlock();
      expect(again.state).toBe('running');
      expect(context.resumes > 0 || again !== context).toBe(true);
    });

    it('replaces a context whose resume never settles', async () => {
      const audio = player();
      const context = await audio.unlock();
      context.setState('suspended');
      context.resumeMode = 'hang';
      const began = Date.now();
      const again = await audio.unlock();
      expect(Date.now() - began < 1000).toBe(true);
      expect(again).not.toBe(context);
      expect(again.state).toBe('running');
      expect(context.state).toBe('closed');
    });

    it('replaces a closed context', async () => {
      const audio = player();
      const context = await audio.unlock();
      context.setState('closed');
      const again = await audio.unlock();
      expect(again).not.toBe(context);
      expect(again.state).toBe('running');
    });

    it('resumes the context as soon as the tab is visible again', async () => {
      const page = fakePage();
      const audio = player();
      const context = await audio.unlock();
      const stop = audio.watch(page);
      context.setState('interrupted');
      page.document.visibilityState = 'hidden';
      page.fire('visibilitychange');
      expect(context.state).toBe('interrupted');
      page.document.visibilityState = 'visible';
      page.fire('visibilitychange');
      expect(context.state).toBe('running');
      // A later user gesture also revives it (Safari needs one).
      context.setState('interrupted');
      page.fire('pointerdown');
      expect(context.state).toBe('running');
      stop();
      expect(page.listeners.length).toBe(0);
    });

    it('reschedules the rest of an utterance when the clock stalls', async () => {
      let wall = 0;
      const audio = player({ now: () => wall, stallTimeout: 1 });
      const context = await audio.unlock();
      audio.begin(1000);
      const chunks = [0, 100, 200, 300].map((start) => ({
        start,
        samples: new Float32Array(100),
      }));
      for (const chunk of chunks) {
        audio.push(chunk.start, chunk.samples);
      }
      context.advance(0.3);
      wall = 0.2;
      expect(audio.stalled()).toBe(false);
      // The output device is gone: the state says running but time stands.
      wall = 0.5;
      expect(audio.stalled()).toBe(false);
      wall = 1.6;
      expect(audio.stalled()).toBe(true);
      const time = audio.time();
      audio.recover(chunks);
      const fresh = FakeContext.created.at(-1);
      expect(fresh).not.toBe(context);
      expect(context.state).toBe('closed');
      // Playback continues where it stopped: chunks already heard are skipped.
      expect(Math.abs(audio.time() - (time - 0.15)) < 1e-9).toBe(true);
      expect(fresh.started.length).toBe(3);
    });

    it('keeps the engine working after an interrupted context', async () => {
      const posted = [];
      const worker = {
        addEventListener() {},
        postMessage: (message) => posted.push(message),
        terminate() {},
      };
      const engine = new VoiceEngine({ createWorker: () => worker });
      engine.player = player();
      const request = {
        text: 'a',
        lang: 'en',
        head: {},
        seed: '1',
        mode: 'both',
      };
      await engine.speak(request);
      engine.player.context.setState('interrupted');
      engine.player.context.resumeMode = 'hang';
      await engine.speak(request);
      const speaks = posted.filter((message) => message.type === 'speak');
      expect(speaks.length).toBe(2);
      expect(engine.player.context.state).toBe('running');
      engine.dispose();
    });
  });
}

describe('WorkletPlayer without AudioWorklet', () => {
  it('uses buffer sources', async () => {
    const audio = makePlayer(WorkletPlayer);
    expect(audio.mode).toBe(null);
    await audio.unlock();
    expect(audio.mode).toBe('buffer');
    audio.begin(1000);
    audio.push(0, new Float32Array(100));
    expect(FakeContext.created[0].started.length).toBe(1);
  });

  it('can be told not to use the worklet', () => {
    expect(new WorkletPlayer({ worklet: false }).mode).toBe('buffer');
  });

  it('is the player of the engine and reports its mode', async () => {
    const worker = {
      addEventListener() {},
      postMessage() {},
      terminate() {},
    };
    const engine = new VoiceEngine({ createWorker: () => worker });
    expect(engine.player instanceof WorkletPlayer).toBe(true);
    engine.player = makePlayer(WorkletPlayer);
    await engine.speak({
      text: 'a',
      lang: 'en',
      head: {},
      seed: '1',
      mode: 'both',
    });
    expect(engine.status.audioMode).toBe('buffer');
    engine.dispose();
  });
});
