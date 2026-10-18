/**
 * Plays audio chunks as they arrive from the simulation. Chunks are
 * scheduled back to back on the AudioContext clock with a small lead; if
 * the simulation falls behind, the timeline is shifted so playback resumes
 * without clicks from overlapping buffers.
 *
 * Browsers suspend or interrupt the context of a tab in the background
 * (Safari reports the non-standard state 'interrupted'), and a context can
 * also stall: 'running' while its clock stands still, e.g. after the output
 * device went away. The player resumes the context whenever it is not
 * running, replaces one that cannot be resumed and reschedules the rest of
 * an utterance on the new context (issue 9).
 */

const LEAD = 0.15;
const MIN_AHEAD = 0.03;
/** Seconds to wait for resume() before replacing the context. */
const RESUME_TIMEOUT = 0.8;
/** Seconds of a running context without clock progress that count as a stall. */
const STALL_TIMEOUT = 1.5;
/** Events after which a hidden or interrupted context is resumed. */
const DOCUMENT_EVENTS = ['visibilitychange', 'pointerdown', 'keydown'];
const WINDOW_EVENTS = ['pageshow', 'focus'];

function defaultContext() {
  const AudioContextClass =
    globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio is not available');
  }
  return new AudioContextClass({ latencyHint: 'interactive' });
}

/** Resolves true when `promise` settles in time, false otherwise. */
function settles(promise, seconds) {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => resolve(false), seconds * 1000);
    Promise.resolve(promise)
      .catch(() => {})
      .then(() => {
        globalThis.clearTimeout(timer);
        resolve(true);
      });
  });
}

export class AudioPlayer {
  /**
   * @param {{createContext?: () => AudioContext, resumeTimeout?: number, stallTimeout?: number, now?: () => number}} [options]
   *   `resumeTimeout` in milliseconds, `stallTimeout` and `now()` in seconds.
   */
  constructor(options = {}) {
    this.createContext = options.createContext ?? defaultContext;
    this.resumeTimeout =
      (options.resumeTimeout ?? RESUME_TIMEOUT * 1000) / 1000;
    this.stallTimeout = options.stallTimeout ?? STALL_TIMEOUT;
    this.now = options.now ?? (() => globalThis.performance.now() / 1000);
    this.context = null;
    this.sources = new Set();
    this.origin = null;
    this.sampleRate = 48000;
    this.underruns = 0;
    this.recoveries = 0;
    this.clock = null;
  }

  #replace() {
    const old = this.context;
    this.context = this.createContext();
    this.clock = null;
    if (old && old.state !== 'closed') {
      Promise.resolve(old.close?.()).catch(() => {});
    }
    return this.context;
  }

  /**
   * Create or resume the AudioContext (call from a user gesture). A context
   * that is closed, or does not resume in time, is replaced.
   */
  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      this.#replace();
    }
    if (this.context.state !== 'running') {
      await settles(this.context.resume(), this.resumeTimeout);
    }
    if (this.context.state !== 'running') {
      this.#replace();
      if (this.context.state !== 'running') {
        await settles(this.context.resume(), this.resumeTimeout);
      }
    }
    return this.context;
  }

  /**
   * Resume a suspended or interrupted context without waiting (from page
   * events, which may or may not count as a user gesture).
   */
  revive() {
    const { context } = this;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      Promise.resolve(context.resume()).catch(() => {});
    }
  }

  /**
   * Revive the context when the page becomes visible again and on the next
   * user gesture. Returns a function that removes the listeners.
   * @param {{window?: EventTarget, document?: EventTarget & {visibilityState?: string}}} [page]
   */
  watch(page = { window: globalThis, document: globalThis.document }) {
    const { window, document } = page;
    const onEvent = () => {
      if (document?.visibilityState !== 'hidden') {
        this.revive();
      }
    };
    const targets = [
      [document, DOCUMENT_EVENTS],
      [window, WINDOW_EVENTS],
    ].filter(([target]) => target?.addEventListener);
    for (const [target, events] of targets) {
      for (const type of events) {
        target.addEventListener(type, onEvent);
      }
    }
    return () => {
      for (const [target, events] of targets) {
        for (const type of events) {
          target.removeEventListener(type, onEvent);
        }
      }
    };
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
    this.clock ??= { time: context.currentTime, wall: this.now() };
  }

  /** Playback position in seconds of utterance time, or null before start. */
  time() {
    if (!this.context || this.origin === null) {
      return null;
    }
    return this.context.currentTime - this.origin;
  }

  /**
   * Whether the context says it is running but its clock has not moved for
   * `stallTimeout` seconds while audio is scheduled. Call it regularly
   * (every animation frame) while the page is visible.
   */
  stalled() {
    const { context } = this;
    if (!context || context.state !== 'running' || this.sources.size === 0) {
      this.clock = null;
      return false;
    }
    const now = this.now();
    if (!this.clock || this.clock.time !== context.currentTime) {
      this.clock = { time: context.currentTime, wall: now };
      return false;
    }
    return now - this.clock.wall > this.stallTimeout;
  }

  /**
   * Move playback to a fresh context and schedule the chunks of the current
   * utterance that have not been heard yet, from where playback stopped.
   * @param {{start: number, samples: Float32Array}[]} chunks
   */
  recover(chunks) {
    const resumeAt = Math.max(0, this.time() ?? 0);
    this.stop();
    const context = this.#replace();
    this.recoveries++;
    Promise.resolve(context.resume?.()).catch(() => {});
    this.origin = context.currentTime + LEAD - resumeAt;
    for (const { start, samples } of chunks) {
      if ((start + samples.length) / this.sampleRate > resumeAt) {
        this.push(start, samples);
      }
    }
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
    this.clock = null;
  }
}
