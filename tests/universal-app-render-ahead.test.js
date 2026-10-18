/**
 * Render ahead in the app: playback of a tier slower than real time waits
 * until the rest of the utterance will be ready before the player needs it.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  readyToPlay,
  secondsToPlay,
} from '../examples/universal-app/src/engine/render-ahead.js';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';

const RATE = 1000;

describe('render ahead', () => {
  it('plays at once when rendering keeps up with real time', () => {
    const progress = {
      rendered: 100,
      total: 1000,
      busy: 0.05,
      sampleRate: RATE,
    };
    expect(readyToPlay(progress)).toBe(true);
    expect(secondsToPlay(progress)).toBe(0);
  });

  it('waits until the rest renders before the player reaches it', () => {
    // Load 4 with a safety of 1: start when 3/4 of the utterance exists.
    const at = (rendered) => ({
      rendered,
      total: 1000,
      busy: (4 * rendered) / RATE,
      sampleRate: RATE,
      safety: 1,
    });
    expect(readyToPlay(at(700))).toBe(false);
    expect(readyToPlay(at(750))).toBe(true);
    expect(Math.abs(secondsToPlay(at(500)) - 1)).toBeLessThan(1e-6);
    // Simulate playing from 750: the renderer always stays ahead.
    for (let t = 0; t <= 1; t += 0.01) {
      const rendered = Math.min(1000, 750 + (t * RATE) / 4);
      expect(rendered + 1e-9 >= Math.min(1000, t * RATE)).toBe(true);
    }
  });

  it('never plays before a first measurement, always once everything exists', () => {
    expect(
      readyToPlay({ rendered: 10, total: 1000, busy: 0, sampleRate: RATE })
    ).toBe(false);
    expect(
      readyToPlay({ rendered: 1000, total: 1000, busy: 50, sampleRate: RATE })
    ).toBe(true);
  });
});

function fakeWorker() {
  const worker = {
    posted: [],
    listeners: [],
    addEventListener(type, listener) {
      if (type === 'message') {
        worker.listeners.push(listener);
      }
    },
    postMessage(message) {
      worker.posted.push(message);
    },
    reply(data) {
      for (const listener of worker.listeners) {
        listener({ data });
      }
    },
    terminate() {},
  };
  return worker;
}

function fakePlayer() {
  return {
    pushed: [],
    begin() {},
    push(start) {
      this.pushed.push(start);
    },
    stop() {},
    time: () => null,
    stalled: () => false,
    underruns: 0,
  };
}

function engineWithJob() {
  const worker = fakeWorker();
  const engine = new VoiceEngine({ createWorker: () => worker });
  engine.player = fakePlayer();
  engine.benchmark({});
  worker.reply({ type: 'benchmark', level: 5, loads: [] });
  engine.job = {
    id: 3,
    sound: true,
    chunks: [],
    fields: [],
    fieldIndex: 0,
    rendered: 0,
    busy: 0,
    playing: false,
  };
  worker.reply({
    type: 'start',
    id: 3,
    sampleRate: RATE,
    totalSamples: 1000,
    solver: 'fdtd3d',
  });
  return { worker, engine };
}

describe('voice engine render ahead', () => {
  it('holds slow chunks back, reports progress and then plays them all', () => {
    const { worker, engine } = engineWithJob();
    const pushed = engine.player.pushed;
    // Load 5 (x 1.2 safety): playback waits for 5/6 of the utterance.
    for (let start = 0; start < 1000; start += 100) {
      worker.reply({
        type: 'chunk',
        id: 3,
        start,
        samples: new Float32Array(100),
        load: 5,
      });
      if (start === 300) {
        expect(pushed.length).toBe(0);
        expect(Math.abs(engine.status.rendering.progress - 0.4)).toBeLessThan(
          1e-6
        );
        expect(engine.status.rendering.wait > 0).toBe(true);
      }
    }
    expect(pushed).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(engine.status.rendering).toBe(null);
    worker.reply({ type: 'end', id: 3 });
    expect(pushed.length).toBe(10);
  });

  it('plays real-time chunks as soon as the load is measured', () => {
    const { worker, engine } = engineWithJob();
    worker.reply({
      type: 'chunk',
      id: 3,
      start: 0,
      samples: new Float32Array(100),
      load: 0.3,
    });
    expect(engine.player.pushed).toEqual([0]);
    worker.reply({
      type: 'chunk',
      id: 3,
      start: 100,
      samples: new Float32Array(100),
      load: 0.3,
    });
    expect(engine.player.pushed).toEqual([0, 100]);
  });
});

describe('app defaults', () => {
  it('picks the tier for the device and shows the render-ahead wait', () => {
    const app = readFileSync('examples/universal-app/src/App.js', 'utf8');
    expect(app).toContain("tier: 'auto',");
    const simulator = readFileSync(
      'examples/universal-app/src/engine/use-simulator.js',
      'utf8'
    );
    expect(simulator).toContain('{ gpu: allowGpu }');
    expect(app).toContain('renderingNote(status.rendering, t)');
  });
});
