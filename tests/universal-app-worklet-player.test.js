/**
 * Issue 27: WorkletPlayer of the example app on a fake AudioContext whose
 * AudioWorklet runs the real processor (src/playback/worklet-processor.js)
 * in the faked worklet scope of tests/helpers/fake-worklet.js.
 */

import { describe, it, expect } from 'test-anywhere';
import { resample } from '../src/audio/resample.js';
import { createRandom } from '../src/random.js';
import { WorkletPlayer } from '../examples/universal-app/src/engine/worklet-player.js';
import { loadPlayerProcessor } from './helpers/fake-worklet.js';

const RATE = 48000;
const BLOCK = 128;

/** An AudioContext at 48 kHz with an AudioWorklet of fake nodes. */
class WorkletContext {
  constructor(Processor, options = {}) {
    this.Processor = Processor;
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = RATE;
    this.destination = {};
    this.modules = [];
    this.nodes = [];
    this.started = [];
    this.audioWorklet = {
      addModule: (url) => {
        this.modules.push(url);
        return options.fail
          ? Promise.reject(new Error('404'))
          : Promise.resolve();
      },
    };
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }

  createBuffer(channels, length) {
    return { length, copyToChannel() {} };
  }

  createBufferSource() {
    return {
      connect() {},
      start: (when) => this.started.push(when),
      stop() {},
    };
  }

  /** Render `blocks` quanta through the connected nodes; returns the mix. */
  render(blocks) {
    const result = new Float32Array(blocks * BLOCK);
    for (let block = 0; block < blocks; block++) {
      globalThis.currentTime = this.currentTime;
      for (const node of this.nodes.filter((item) => item.connected)) {
        const out = new Float32Array(BLOCK);
        node.processor.process([], [[out]]);
        for (let index = 0; index < BLOCK; index++) {
          result[block * BLOCK + index] += out[index];
        }
      }
      this.currentTime += BLOCK / RATE;
    }
    return result;
  }
}

/** An AudioWorkletNode whose port talks to a processor instance. */
function createNode(context, name, options) {
  const processor = new context.Processor(options);
  const node = {
    context,
    name,
    options,
    processor,
    connected: false,
    connect() {
      this.connected = true;
    },
    disconnect() {
      this.connected = false;
    },
    port: {
      onmessage: null,
      postMessage: (message) => processor.port.receive(message),
    },
  };
  processor.port.postMessage = (message) =>
    node.port.onmessage?.({ data: message });
  context.nodes.push(node);
  return node;
}

async function setup(options = {}) {
  const Processor = await loadPlayerProcessor();
  const contexts = [];
  const player = new WorkletPlayer({
    createContext: () => {
      const context = new WorkletContext(Processor, options);
      contexts.push(context);
      return context;
    },
    createNode,
    isolated: () => Boolean(options.shared),
    resumeTimeout: 20,
    ...options.player,
  });
  await player.unlock();
  return { player, contexts, context: () => contexts.at(-1) };
}

/** `seconds` of a 440 Hz sine with seeded noise at `rate`. */
function signal(rate, seconds = 1) {
  const random = createRandom('issue-27-player');
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, index) =>
      0.5 * Math.sin((2 * Math.PI * 440 * index) / rate) +
      0.1 * (random() - 0.5)
  );
}

function chunked(samples, size) {
  const chunks = [];
  for (let start = 0; start < samples.length; start += size) {
    chunks.push({ start, samples: samples.slice(start, start + size) });
  }
  return chunks;
}

function maxDifference(a, b) {
  let max = 0;
  for (let index = 0; index < b.length; index++) {
    max = Math.max(max, Math.abs(a[index] - b[index]));
  }
  return max;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WorkletPlayer', () => {
  it('loads the processor and plays the resampled stream (port mode)', async () => {
    const { player, context } = await setup();
    expect(player.mode).toBe('worklet-port');
    const [url] = context().modules;
    expect(url.endsWith('src/playback/worklet-processor.js')).toBe(true);
    const [node] = context().nodes;
    expect(node.name).toBe('voice-simulator-player');
    expect(node.options.numberOfInputs).toBe(0);
    expect(node.options.outputChannelCount).toEqual([1]);
    expect(node.connected).toBe(true);
    // A second unlock keeps the node.
    await player.unlock();
    expect(context().modules.length).toBe(1);

    const input = signal(16000);
    player.begin(16000);
    expect(player.time()).toBe(null);
    for (const { start, samples } of chunked(input, 1600)) {
      player.push(start, samples);
    }
    player.end();
    const first = context().render(100);
    expect(Math.abs(player.time() - (100 * BLOCK) / RATE) < 0.01).toBe(true);
    const rest = context().render(300);
    const output = new Float32Array(first.length + rest.length);
    output.set(first);
    output.set(rest, first.length);
    const whole = resample(input, 16000, RATE, { zeroCrossings: 8 });
    expect(maxDifference(output, whole) <= 1e-6).toBe(true);
    expect(output.subarray(whole.length).every((v) => v === 0)).toBe(true);
    expect(player.underruns).toBe(0);
    expect(player.hasQueued()).toBe(false);
    // Everything was played: the clock runs on past the end.
    context().render(40);
    expect(player.time() > 1.05).toBe(true);
  });

  it('streams through the shared ring and refills it (shared mode)', async () => {
    const { player, context } = await setup({ shared: true });
    expect(player.mode).toBe('worklet-shared');
    expect(player.ring.capacity).toBe(3 * RATE);
    const input = signal(RATE, 4);
    player.begin(RATE);
    for (const { start, samples } of chunked(input, 4800)) {
      player.push(start, samples);
    }
    player.end();
    // 4 s do not fit in the 3 s ring: the rest waits for the pump.
    expect(player.pending.length > 0).toBe(true);
    const parts = [];
    for (let round = 0; round < 8; round++) {
      parts.push(context().render(200));
      await sleep(30);
    }
    const output = new Float32Array(parts.length * 200 * BLOCK);
    parts.forEach((part, index) => output.set(part, index * part.length));
    expect(maxDifference(output, input)).toBe(0);
    expect(player.underruns).toBe(0);
    expect(player.pending.length).toBe(0);
    expect(player.timer).toBe(null);
    expect(player.time() >= 4).toBe(true);
    player.stop();
  });

  for (const shared of [false, true]) {
    it(`counts the underruns of the processor (${shared ? 'shared' : 'port'})`, async () => {
      const { player, context } = await setup({ shared });
      player.begin(RATE);
      player.push(0, new Float32Array(RATE / 10).fill(0.5));
      context().render(60);
      expect(player.underruns).toBe(1);
      expect(player.stalled()).toBe(false);
      // A new utterance starts the count again.
      player.begin(RATE);
      context().render(8);
      expect(player.underruns).toBe(0);
    });
  }

  it('drops what is queued on stop', async () => {
    const { player, context } = await setup();
    player.begin(RATE);
    player.push(0, new Float32Array(RATE).fill(0.5));
    context().render(10);
    player.stop();
    expect(player.hasQueued()).toBe(false);
    expect(
      context()
        .render(20)
        .every((v) => v === 0)
    ).toBe(true);
  });

  it('skips overlapping samples and fills gaps with silence', async () => {
    const { player, context } = await setup();
    player.begin(RATE);
    player.push(0, new Float32Array(100).fill(1));
    player.push(50, new Float32Array(100).fill(2));
    player.push(200, new Float32Array(50).fill(3));
    player.end();
    const out = context().render(2);
    expect(out.subarray(0, 100).every((v) => v === 1)).toBe(true);
    expect(out.subarray(100, 150).every((v) => v === 2)).toBe(true);
    expect(out.subarray(150, 200).every((v) => v === 0)).toBe(true);
    expect(out.subarray(200, 250).every((v) => v === 3)).toBe(true);
  });

  it('uses buffer sources when the module does not load', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { player, context } = await setup({ fail: true });
      expect(player.mode).toBe('buffer');
      expect(context().nodes.length).toBe(0);
      player.begin(RATE);
      player.push(0, new Float32Array(100));
      expect(context().started.length).toBe(1);
    } finally {
      console.warn = warn;
    }
  });

  it('continues on a fresh context from the playback position', async () => {
    const { player, contexts, context } = await setup();
    const input = signal(RATE);
    const chunks = chunked(input, 4800);
    player.begin(RATE);
    for (const { start, samples } of chunks) {
      player.push(start, samples);
    }
    player.end();
    context().render(150);
    const position = player.time();
    await player.recover(chunks);
    expect(contexts.length).toBe(2);
    expect(contexts[0].state).toBe('closed');
    expect(context().modules.length).toBe(1);
    expect(player.mode).toBe('worklet-port');
    expect(player.recoveries).toBe(1);
    expect(Math.abs(player.time() - position) < 1e-3).toBe(true);
    const from = Math.floor(position * RATE);
    const output = context().render(Math.ceil((RATE - from) / BLOCK) + 10);
    expect(maxDifference(output, input.subarray(from))).toBe(0);
    expect(player.time() >= 1).toBe(true);
  });
});
