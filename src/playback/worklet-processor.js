/**
 * AudioWorklet processor of the streaming player (issue 27): plays the
 * chunks of an utterance as one continuous mono stream from a ring buffer
 * or a message queue.
 *
 * Loaded by URL with `audioWorklet.addModule`, so this file has no imports;
 * it repeats `ringRead` and the header indices of ./ring-buffer.js (a test
 * compares the two copies).
 *
 * Sources:
 * - shared mode: `{type: 'ring', buffer}` hands over a SharedArrayBuffer
 *   ring (see ./ring-buffer.js); the header carries the end, the reset
 *   (`EPOCH`), the played samples and the underruns, and nothing is posted;
 * - port mode (the default): `{type: 'chunk', samples}` appends samples to
 *   a queue, `{type: 'end'}` and `{type: 'reset'}` act as `ENDED` and
 *   `EPOCH`. Every 8 blocks the processor posts
 *   `{type: 'position', played, underruns, time, epoch, playing, buffered,
 *   ended}` (`time` is `currentTime`, `epoch` the number of resets).
 *
 * States: `buffering` outputs zeros until `START` samples are buffered
 * (0.05 s on the first start, 0.1 s after an underrun) or the stream has
 * ended; then `playing`. When fewer than two blocks are buffered before the
 * end, the player fades the next block out (a ramp from 1 to 0), counts an
 * underrun and buffers again; the first block after that fades in. At the
 * end it plays what is left, then zeros.
 */

/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentTime */

const RING_WRITE = 0;
const RING_READ = 1;
const RING_PLAYED = 2;
const RING_UNDERRUNS = 3;
const RING_ENDED = 4;
const RING_EPOCH = 5;
const RING_HEADER_BYTES = 32;

/** Seconds buffered before the first sample plays. */
const FIRST_START = 0.05;
/** Seconds buffered before playback resumes after an underrun. */
const RESTART = 0.1;
/** Blocks between two position messages in port mode. */
const POSITION_BLOCKS = 8;

/** The `ringRead` of ./ring-buffer.js; keep the two copies the same. */
function ringRead(ring, out, count) {
  const { header, samples, capacity } = ring;
  const read = Atomics.load(header, RING_READ);
  const write = Atomics.load(header, RING_WRITE);
  const available = (write - read + capacity) % capacity;
  const total = Math.max(0, Math.min(available, count, out.length));
  for (let index = 0; index < total; index++) {
    out[index] = samples[(read + index) % capacity];
  }
  // A reset in between moved READ: keep its value, the samples are dropped.
  Atomics.compareExchange(header, RING_READ, read, (read + total) % capacity);
  return total;
}

function ringFromBuffer(buffer) {
  const capacity = (buffer.byteLength - RING_HEADER_BYTES) / 4;
  return {
    header: new Int32Array(buffer, 0, 8),
    samples: new Float32Array(buffer, RING_HEADER_BYTES, capacity),
    capacity,
  };
}

/** Samples queued from the port: a list of chunks and a read offset. */
class PortQueue {
  constructor() {
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
  }

  push(samples) {
    if (samples.length > 0) {
      this.chunks.push(samples);
      this.length += samples.length;
    }
  }

  read(out, count) {
    let total = 0;
    const wanted = Math.min(count, out.length, this.length);
    while (total < wanted) {
      const chunk = this.chunks[0];
      const take = Math.min(wanted - total, chunk.length - this.offset);
      out.set(chunk.subarray(this.offset, this.offset + take), total);
      total += take;
      this.offset += take;
      if (this.offset === chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    this.length -= total;
    return total;
  }

  clear() {
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
  }
}

class VoiceSimulatorPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = null;
    this.queue = new PortQueue();
    this.epoch = 0;
    this.ended = false;
    this.played = 0;
    this.underruns = 0;
    this.blocks = 0;
    this.#restart();
    this.port.onmessage = (event) => this.#message(event.data);
  }

  /** Back to `buffering` with the first-start threshold. */
  #restart() {
    this.playing = false;
    this.start = Math.round(FIRST_START * sampleRate);
    this.fadeIn = false;
  }

  #message(message) {
    if (message?.type === 'ring') {
      this.ring = ringFromBuffer(message.buffer);
      this.epoch = Atomics.load(this.ring.header, RING_EPOCH);
      this.#restart();
    } else if (message?.type === 'chunk') {
      this.queue.push(message.samples);
    } else if (message?.type === 'end') {
      this.ended = true;
    } else if (message?.type === 'reset') {
      this.queue.clear();
      this.epoch++;
      this.ended = false;
      this.played = 0;
      this.underruns = 0;
      this.#restart();
    }
  }

  /** Shared mode: start over when the writer has reset the ring. */
  #checkEpoch() {
    const { header } = this.ring;
    const epoch = Atomics.load(header, RING_EPOCH);
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      Atomics.store(header, RING_PLAYED, 0);
      Atomics.store(header, RING_UNDERRUNS, 0);
      this.#restart();
    }
  }

  #buffered() {
    if (!this.ring) {
      return this.queue.length;
    }
    const { header, capacity } = this.ring;
    const write = Atomics.load(header, RING_WRITE);
    const read = Atomics.load(header, RING_READ);
    return (write - read + capacity) % capacity;
  }

  #hasEnded() {
    return this.ring
      ? Atomics.load(this.ring.header, RING_ENDED) === 1
      : this.ended;
  }

  #read(out, count) {
    return this.ring
      ? ringRead(this.ring, out, count)
      : this.queue.read(out, count);
  }

  #count(played, underrun) {
    if (this.ring) {
      Atomics.add(this.ring.header, RING_PLAYED, played);
      if (underrun) {
        Atomics.add(this.ring.header, RING_UNDERRUNS, 1);
      }
    } else {
      this.played += played;
      this.underruns += underrun ? 1 : 0;
    }
  }

  /** Fill `out` (one render quantum of any length) from the stream. */
  #render(out) {
    const n = out.length;
    if (this.ring) {
      this.#checkEpoch();
    }
    const buffered = this.#buffered();
    const ended = this.#hasEnded();
    if (!this.playing) {
      if (buffered < Math.max(this.start, 2 * n) && !ended) {
        return;
      }
      this.playing = true;
    }
    if (buffered < 2 * n && !ended) {
      // Underrun: fade out the next block and wait for more.
      const read = this.#read(out, n);
      for (let index = 0; index < read; index++) {
        out[index] *= (n - 1 - index) / n;
      }
      out.fill(0, read);
      this.#count(read, true);
      this.playing = false;
      this.start = Math.round(RESTART * sampleRate);
      this.fadeIn = true;
      return;
    }
    const read = this.#read(out, n);
    out.fill(0, read);
    if (this.fadeIn) {
      for (let index = 0; index < read; index++) {
        out[index] *= index / n;
      }
      this.fadeIn = false;
    }
    this.#count(read, false);
  }

  #postPosition() {
    this.blocks++;
    if (this.ring || this.blocks % POSITION_BLOCKS !== 0) {
      return;
    }
    this.port.postMessage({
      type: 'position',
      played: this.played,
      underruns: this.underruns,
      time: currentTime,
      epoch: this.epoch,
      playing: this.playing,
      buffered: this.queue.length,
      ended: this.ended,
    });
  }

  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (out) {
      out.fill(0);
      this.#render(out);
      for (let channel = 1; channel < outputs[0].length; channel++) {
        outputs[0][channel].set(out);
      }
    }
    this.#postPosition();
    return true;
  }
}

/** The copy of `ringRead` (compared with ./ring-buffer.js by a test). */
VoiceSimulatorPlayer.ringRead = ringRead;

registerProcessor('voice-simulator-player', VoiceSimulatorPlayer);
