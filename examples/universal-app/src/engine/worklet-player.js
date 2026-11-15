/**
 * Streaming player on one AudioWorkletNode (issue 27). The chunks of an
 * utterance are resampled to the device rate on the main thread and handed
 * to the processor of src/playback/worklet-processor.js, which plays them as
 * one continuous stream, fades out on an underrun and fades in again.
 *
 * Modes (`mode`):
 * - 'worklet-shared': the page is cross-origin isolated, the samples go
 *   through a SharedArrayBuffer ring of 3 s (browsers run the timers of a
 *   hidden tab at most every second, so the ring outlasts a pause);
 * - 'worklet-port': the samples are posted to the node's message port and
 *   the processor reports its position every 8 blocks;
 * - 'buffer': no AudioWorklet (or it failed to load): every method is the
 *   one of AudioPlayer, one buffer source per chunk.
 * `mode` is null until `unlock()` has decided.
 */

import { createStreamResampler } from '../../../../src/audio/resample.js';
import {
  PLAYER_PROCESSOR_NAME,
  RING,
  createRing,
  ringAvailable,
  ringEnd,
  ringReset,
  ringWrite,
} from '../../../../src/playback/index.js';
import { AudioPlayer } from './audio-player.js';

/** Seconds of audio the shared ring holds. */
const RING_SECONDS = 3;
/** Milliseconds between two attempts to move queued samples into the ring. */
const PUMP_INTERVAL = 20;

function defaultCreateNode(context, name, options) {
  return new globalThis.AudioWorkletNode(context, name, options);
}

function defaultIsolated() {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof globalThis.SharedArrayBuffer === 'function'
  );
}

export class WorkletPlayer extends AudioPlayer {
  /**
   * @param {ConstructorParameters<typeof AudioPlayer>[0] & {worklet?: boolean, processorUrl?: string|URL, createNode?: (context: AudioContext, name: string, options: object) => AudioWorkletNode, isolated?: () => boolean}} [options]
   *   `worklet: false` forces the 'buffer' mode; `processorUrl` replaces the
   *   URL of the processor module; `createNode` and `isolated` are for tests.
   */
  constructor(options = {}) {
    super(options);
    this.processorUrl =
      options.processorUrl ??
      new URL('../../../../src/playback/worklet-processor.js', import.meta.url);
    this.createNode = options.createNode ?? defaultCreateNode;
    this.isolated = options.isolated ?? defaultIsolated;
    /** @type {'worklet-shared'|'worklet-port'|'buffer'|null} */
    this.mode = options.worklet === false ? 'buffer' : null;
    this.node = null;
    this.ring = null;
    this.timer = null;
    this.resets = 0;
    this.resampler = null;
    // Seconds of utterance time before the first sample of the stream
    // (more than 0 after a recovery).
    this.base = 0;
    this.#clearStream();
  }

  get #active() {
    return this.mode === 'worklet-shared' || this.mode === 'worklet-port';
  }

  /** Underruns of this utterance, counted by the processor. */
  get underruns() {
    if (!this.#active) {
      return this.bufferUnderruns;
    }
    return this.ring
      ? Atomics.load(this.ring.header, RING.UNDERRUNS)
      : (this.position?.underruns ?? 0);
  }

  set underruns(value) {
    this.bufferUnderruns = value;
  }

  /** Create or resume the context and load the processor into it. */
  async unlock() {
    const context = await super.unlock();
    if (
      this.mode !== 'buffer' &&
      (!this.node || this.node.context !== context)
    ) {
      await this.#attach(context);
    }
    return context;
  }

  /**
   * Load the processor module into `context` and connect a node.
   * @returns {Promise<boolean>} false when the 'buffer' mode is used
   */
  async #attach(context) {
    this.#detach();
    try {
      if (!context.audioWorklet) {
        throw new Error('AudioWorklet is not available');
      }
      await context.audioWorklet.addModule(String(this.processorUrl));
      if (context !== this.context) {
        return false;
      }
      const node = this.createNode(context, PLAYER_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.connect(context.destination);
      this.node = node;
      this.resets = 0;
      if (this.isolated()) {
        const capacity = Math.ceil(RING_SECONDS * context.sampleRate);
        this.ring = createRing(capacity, { shared: true });
        node.port.postMessage({ type: 'ring', buffer: this.ring.buffer });
        this.mode = 'worklet-shared';
      } else {
        node.port.onmessage = (event) => this.#message(event.data);
        this.mode = 'worklet-port';
      }
      return true;
    } catch (error) {
      if (context.audioWorklet) {
        console.warn('AudioWorklet player failed, using buffer sources', error);
      }
      this.#detach();
      this.mode = 'buffer';
      return false;
    }
  }

  #detach() {
    this.#stopPump();
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.node = null;
    this.ring = null;
  }

  #message(message) {
    if (message?.type === 'position' && message.epoch === this.resets) {
      this.#observe(message.played, message.time);
      this.position = message;
    }
  }

  /**
   * Remember the context time at which the stream would have started had it
   * played without pauses, whenever the played count moves: after the stream
   * has drained, the clock runs on from there.
   */
  #observe(played, time) {
    if (played !== this.observed) {
      this.observed = played;
      this.anchor = time - played / this.context.sampleRate;
    }
  }

  /** Forget the stream of the current utterance, here and in the processor. */
  #clearStream() {
    this.#stopPump();
    this.pending = [];
    this.pendingOffset = 0;
    this.resampler = null;
    // Input samples (utterance rate) and output samples (device rate)
    // handed over so far, and the state of the end of the stream.
    this.received = 0;
    this.pushed = 0;
    this.ending = false;
    this.endSent = false;
    this.position = null;
    this.observed = 0;
    this.anchor = 0;
    if (this.ring) {
      ringReset(this.ring);
    } else if (this.node) {
      this.resets++;
      this.node.port.postMessage({ type: 'reset' });
    }
  }

  /** Start a new utterance at `sampleRate`. */
  begin(sampleRate) {
    super.begin(sampleRate);
    if (this.#active) {
      this.base = 0;
      this.resampler = createStreamResampler(
        sampleRate,
        this.context.sampleRate
      );
    }
  }

  /**
   * Queue samples that start at `start` (in samples from the beginning of
   * the utterance). Chunks are expected in order; an overlap is skipped and
   * a gap is filled with silence.
   */
  push(start, samples) {
    if (!this.#active) {
      super.push(start, samples);
      return;
    }
    const skip = this.received - start;
    if (!this.resampler || skip >= samples.length) {
      return;
    }
    if (skip < 0) {
      this.#feed(new Float32Array(-skip));
    }
    this.#feed(skip > 0 ? samples.subarray(skip) : samples);
    this.#pump();
  }

  #feed(chunk) {
    this.received += chunk.length;
    this.#queue(this.resampler.push(chunk));
  }

  #queue(samples) {
    if (samples.length > 0) {
      this.pending.push(samples);
    }
  }

  /** No more chunks come for this utterance: play the rest, then silence. */
  end() {
    if (!this.#active || this.ending) {
      return;
    }
    this.ending = true;
    if (this.resampler) {
      this.#queue(this.resampler.flush());
      this.#pump();
    }
  }

  /**
   * Move queued samples to the processor: into the ring while it has room
   * (shared), or as messages (port). Repeats every 20 ms while samples wait.
   */
  #pump() {
    if (!this.node) {
      return;
    }
    if (this.ring) {
      this.#fillRing();
    } else {
      for (const samples of this.pending) {
        this.node.port.postMessage({ type: 'chunk', samples }, [
          samples.buffer,
        ]);
        this.pushed += samples.length;
      }
      this.pending = [];
    }
    if (this.pending.length === 0 && this.ending && this.resampler) {
      if (!this.endSent) {
        this.endSent = true;
        if (this.ring) {
          ringEnd(this.ring);
        } else {
          this.node.port.postMessage({ type: 'end' });
        }
      }
    }
    if (this.pending.length > 0 && this.timer === null) {
      this.timer = globalThis.setInterval(() => this.#pump(), PUMP_INTERVAL);
    } else if (this.pending.length === 0) {
      this.#stopPump();
    }
  }

  #fillRing() {
    while (this.pending.length > 0) {
      const samples = this.pending[0];
      const written = ringWrite(this.ring, samples, this.pendingOffset);
      this.pendingOffset += written;
      this.pushed += written;
      if (this.pendingOffset < samples.length) {
        return;
      }
      this.pending.shift();
      this.pendingOffset = 0;
    }
  }

  #stopPump() {
    if (this.timer !== null) {
      globalThis.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Samples played since the start of the stream and whether all are. */
  #progress() {
    if (this.ring) {
      const played = Atomics.load(this.ring.header, RING.PLAYED);
      const drained = this.endSent && ringAvailable(this.ring) === 0;
      this.#observe(played, this.context.currentTime);
      return {
        played,
        drained,
        time: this.context.currentTime,
        playing: false,
      };
    }
    const position = this.position;
    if (!position) {
      return { played: 0, drained: false };
    }
    return {
      played: position.played,
      drained: this.endSent && position.ended && position.buffered === 0,
      time: position.time,
      playing: position.playing,
    };
  }

  /** Playback position in seconds of utterance time, or null before start. */
  time() {
    if (!this.#active) {
      return super.time();
    }
    const rate = this.context.sampleRate;
    const { played, drained, time, playing } = this.#progress();
    if (played === 0) {
      return this.base > 0 ? this.base : null;
    }
    const now = this.context.currentTime;
    if (drained) {
      // Everything was played: the clock runs on with the context.
      return this.base + Math.max(played / rate, now - this.anchor);
    }
    // Between two position messages (port mode) the processor keeps
    // playing, but never beyond what it was given.
    const elapsed = playing ? Math.max(0, now - time) : 0;
    return this.base + Math.min(played / rate + elapsed, this.pushed / rate);
  }

  /** Whether samples wait in the queue, the ring or the processor. */
  hasQueued() {
    if (!this.#active) {
      return super.hasQueued();
    }
    if (this.pending.length > 0) {
      return true;
    }
    return this.ring
      ? ringAvailable(this.ring) > 0
      : this.pushed > (this.position?.played ?? 0);
  }

  /**
   * Continue on a fresh context from the playback position: load the
   * processor there and push the chunks again from that position.
   * @param {{start: number, samples: Float32Array}[]} chunks the chunks of
   *   the utterance so far (later chunks may still be added to the array)
   */
  recover(chunks) {
    if (!this.#active) {
      super.recover(chunks);
      return;
    }
    const resumeAt = Math.max(0, this.time() ?? 0);
    const ended = this.ending;
    const { sampleRate } = this;
    this.stop();
    this.#detach();
    const context = this.replaceContext();
    this.recoveries++;
    Promise.resolve(context.resume?.()).catch(() => {});
    const from = Math.floor(resumeAt * sampleRate);
    this.base = from / sampleRate;
    return this.#attach(context).then((attached) => {
      if (context !== this.context) {
        return;
      }
      const ending = ended || this.ending;
      if (!attached) {
        // No worklet on the new context: buffer sources from here on.
        this.origin = context.currentTime - this.base;
        for (const { start, samples } of chunks) {
          if (start + samples.length > from) {
            super.push(start, samples);
          }
        }
        return;
      }
      this.#clearStream();
      this.resampler = createStreamResampler(sampleRate, context.sampleRate);
      this.received = from;
      for (const { start, samples } of chunks) {
        this.push(start, samples);
      }
      if (ending) {
        this.end();
      }
    });
  }

  /** Stop playback and drop everything queued. */
  stop() {
    super.stop();
    this.#clearStream();
  }
}
