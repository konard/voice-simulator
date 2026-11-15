/**
 * The AudioWorklet global scope, faked for the player processor of issue 27:
 * `AudioWorkletProcessor` with a recording `port`, `registerProcessor`,
 * `sampleRate` (48000) and `currentTime`. The processor module is imported
 * a single time and `loadPlayerProcessor()` gives the class it registered.
 */

/** The message port of a fake processor: records what it posts. */
export class FakePort {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }

  postMessage(message) {
    this.sent.push(message);
  }

  /** Deliver `message` as if the other side had posted it. */
  receive(message) {
    this.onmessage?.({ data: message });
  }
}

let loading = null;

/** @returns {Promise<Function>} the class registered as 'voice-simulator-player' */
export function loadPlayerProcessor() {
  loading ??= (async () => {
    const registered = new Map();
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        this.port = new FakePort();
      }
    };
    globalThis.registerProcessor = (name, processor) =>
      registered.set(name, processor);
    globalThis.sampleRate = 48000;
    globalThis.currentTime = 0;
    await import('../../src/playback/worklet-processor.js');
    const Processor = registered.get('voice-simulator-player');
    if (!Processor) {
      throw new Error('The processor did not register');
    }
    return Processor;
  })();
  return loading;
}

/**
 * Run `blocks` render quanta of `size` samples through `processor` and
 * return the output; `currentTime` advances with every block.
 */
export function renderBlocks(processor, blocks, size = 128) {
  const result = new Float32Array(blocks * size);
  for (let block = 0; block < blocks; block++) {
    const out = new Float32Array(size);
    expectTrue(processor.process([], [[out]]));
    result.set(out, block * size);
    globalThis.currentTime += size / globalThis.sampleRate;
  }
  return result;
}

function expectTrue(value) {
  if (value !== true) {
    throw new Error('process() must return true');
  }
}
