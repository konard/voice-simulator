/**
 * Plays audio chunks as they arrive from the simulation. Chunks are
 * scheduled back to back on the AudioContext clock with a small lead; if
 * the simulation falls behind, the timeline is shifted so playback resumes
 * without clicks from overlapping buffers.
 */

const LEAD = 0.15;
const MIN_AHEAD = 0.03;

export class AudioPlayer {
  constructor() {
    this.context = null;
    this.sources = new Set();
    this.origin = null;
    this.sampleRate = 48000;
    this.underruns = 0;
  }

  /** Create or resume the AudioContext (call from a user gesture). */
  async unlock() {
    const AudioContextClass =
      globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio is not available');
    }
    this.context ??= new AudioContextClass({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context;
  }

  /** Start a new utterance. */
  begin(sampleRate) {
    this.stop();
    this.sampleRate = sampleRate;
    this.origin = null;
    this.underruns = 0;
  }

  /**
   * Schedule samples that start at `start` (in samples from the beginning
   * of the utterance).
   */
  push(start, samples) {
    const { context } = this;
    if (!context || samples.length === 0) {
      return;
    }
    const offset = start / this.sampleRate;
    this.origin ??= context.currentTime + LEAD - offset;
    const late = context.currentTime + MIN_AHEAD - (this.origin + offset);
    if (late > 0) {
      this.origin += late + LEAD / 2;
      this.underruns++;
    }
    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => this.sources.delete(source);
    source.start(this.origin + offset);
    this.sources.add(source);
  }

  /** Playback position in seconds of utterance time, or null before start. */
  time() {
    if (!this.context || this.origin === null) {
      return null;
    }
    return this.context.currentTime - this.origin;
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.origin = null;
  }
}
