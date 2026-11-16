/**
 * Change the audio tier in the middle of an utterance (issue 29).
 *
 * An AdaptiveStream gives the samples of one utterance at a fixed stream
 * rate. Its "lane" is a renderer of one tier and a streaming resampler from
 * the tier's rate to the stream rate. setLevel asks for another tier; the
 * switch then:
 *
 * 1. lets the old renderer reach a time T that is a whole number of samples
 *    at the stream rate and at both tier rates (a multiple of 1 / g, g =
 *    switchGrid of the three rates), so that both lanes sit on the same
 *    stream samples without any fractional delay;
 * 2. starts a renderer of the new tier at T (the `startTime` option) and
 *    hands it the state of the glottal source (saveSources/restoreSources),
 *    so that the pitch continues in phase and the jitter and shimmer
 *    sequences continue;
 * 3. renders the new lane for `preroll` seconds without hearing it, while
 *    its tract (which starts silent) fills with sound;
 * 4. crossfades over `overlap` seconds. The new lane is first scaled to the
 *    level of the old one over the overlap (`match`, kept for the rest of
 *    the utterance) and the fade law follows the correlation r of the two
 *    lanes over the overlap: (a cos θ + b sin θ) / sqrt(1 + r sin 2θ) keeps
 *    the power constant for any r between 0 (noise: equal-power fade) and 1
 *    (a vowel in phase: linear fade).
 *
 * Noise generators are not handed over: frication noise of two tiers is
 * independent, which is why the fade law looks at r. Without a switch the
 * output is the plain render of the first tier resampled to the stream rate
 * (bit-identical to it at equal rates).
 */

import { AUDIO_TIERS } from '../perf/lod.js';
import { createStreamResampler } from '../audio/resample.js';
import { releaseRenderer } from '../acoustics/voice.js';

/** Largest piece a lane renders at a time (samples at the tier rate). */
const PIECE = 256;

/** Smallest switch grid (Hz): coarser grids would delay a switch too long. */
const MIN_GRID = 20;

/** Bounds of the level match of the new lane. */
const MIN_MATCH = 0.5;
const MAX_MATCH = 2;

/** Energy below which a lane counts as silent. */
const SILENT = 1e-12;

/** Most reverberation tail (s) added to the preroll with a room. */
const MAX_ROOM_PREROLL = 0.25;

function gcd(a, b) {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Greatest common divisor of three sample rates (Hz): a switch happens at a
 * multiple of 1 / switchGrid seconds, where all three clocks have a sample.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number}
 */
export function switchGrid(a, b, c) {
  return gcd(gcd(Math.round(a), Math.round(b)), Math.round(c));
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * One renderer resampled to the stream rate. `start` is the stream sample
 * of its first output; `next` the stream sample of the first sample still
 * held. After the renderer is done the resampler is flushed and the lane
 * gives zeros.
 */
class Lane {
  constructor(renderer, streamRate, start) {
    this.renderer = renderer;
    this.resampler = createStreamResampler(renderer.sampleRate, streamRate);
    this.start = start;
    this.next = start;
    this.queue = [];
    this.ready = 0;
    this.offset = 0;
    this.ended = false;
    this.piece = new Float32Array(PIECE);
  }

  #push(samples) {
    if (samples.length > 0) {
      this.queue.push(samples);
      this.ready += samples.length;
    }
  }

  /** Render one piece of at most `size` samples at the tier rate. */
  async #renderPiece(size) {
    const { renderer } = this;
    const piece = this.piece.subarray(0, Math.min(PIECE, size));
    const written = renderer.done ? 0 : await renderer.renderAsync(piece);
    if (written > 0) {
      this.#push(this.resampler.push(piece.subarray(0, written)));
    }
    if (written === 0 || renderer.done) {
      this.#push(this.resampler.flush());
      this.ended = true;
    }
  }

  /** Render until the renderer is at sample `position` of its rate. */
  async renderTo(position) {
    while (!this.ended && this.renderer.position < position) {
      await this.#renderPiece(position - this.renderer.position);
    }
  }

  /** The next `count` samples (zeros after the end). */
  async take(count) {
    while (this.ready < count && !this.ended) {
      await this.#renderPiece(PIECE);
    }
    const result = new Float32Array(count);
    let filled = 0;
    while (filled < count && this.queue.length > 0) {
      const head = this.queue[0];
      const length = Math.min(count - filled, head.length - this.offset);
      result.set(head.subarray(this.offset, this.offset + length), filled);
      filled += length;
      this.offset += length;
      if (this.offset === head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    this.ready -= filled;
    this.next += count;
    return result;
  }

  /** Render and drop the samples before stream sample `index`. */
  async skipTo(index) {
    if (index > this.next) {
      await this.take(index - this.next);
    }
  }

  close() {
    releaseRenderer(this.renderer);
  }
}

/** The crossfade of two lanes over their next samples (see the header). */
function crossfade(old, next, gain) {
  const length = old.length;
  let aa = 0;
  let bb = 0;
  let ab = 0;
  for (let index = 0; index < length; index++) {
    const a = gain * old[index];
    const b = gain * next[index];
    aa += a * a;
    bb += b * b;
    ab += a * b;
  }
  const silent = aa < SILENT || bb < SILENT;
  const match = silent ? 1 : clamp(Math.sqrt(aa / bb), MIN_MATCH, MAX_MATCH);
  const r = silent ? 0 : clamp(ab / Math.sqrt(aa * bb), 0, 1);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const theta = (((index + 0.5) / length) * Math.PI) / 2;
    const a = gain * old[index];
    const b = gain * next[index] * match;
    samples[index] =
      (a * Math.cos(theta) + b * Math.sin(theta)) /
      Math.sqrt(1 + r * Math.sin(2 * theta));
  }
  return { samples, match, r };
}

/**
 * The samples of one utterance at a fixed rate, from renderers of a tier
 * that may change while it plays.
 */
export class AdaptiveStream {
  /**
   * @param {{
   *   createRenderer: (level: number, extra: {startTime?: number}) => any,
   *   level: number,
   *   streamRate: number,
   *   tiers?: readonly {sampleRate: number}[],
   *   preroll?: number,
   *   overlap?: number,
   *   room?: boolean,
   * }} options `createRenderer(level, extra)` returns a renderer of tier
   *   `level` (it may return a promise) with `extra` merged into its
   *   options. `preroll` (default 0.03 s) is how long the new lane renders
   *   before it is heard, `overlap` (default 0.025 s) the crossfade. With
   *   `room` (a room or an enclosure) the preroll grows by the
   *   reverberation tail, at most 0.25 s, and the level only goes down.
   * @returns {Promise<AdaptiveStream>}
   */
  static async create(options) {
    const stream = new AdaptiveStream(options);
    await stream.ready;
    return stream;
  }

  /**
   * With a `createRenderer` that returns a promise, wait for `ready` (or
   * use AdaptiveStream.create) before reading `totalSamples`.
   * @param {Parameters<typeof AdaptiveStream.create>[0]} options
   */
  constructor(options) {
    this.createRenderer = options.createRenderer;
    this.level = options.level;
    this.streamRate = options.streamRate;
    this.tiers = options.tiers ?? AUDIO_TIERS;
    this.preroll = options.preroll ?? 0.03;
    this.overlap = options.overlap ?? 0.025;
    this.room = Boolean(options.room);
    this.position = 0;
    this.totalSamples = 0;
    this.duration = 0;
    /** @type {{at: number, from: number, level: number, gainDb: number, r: number}[]} */
    this.switches = [];
    this.gain = 1;
    this.lane = null;
    this.request = null;
    this.pending = null;
    this.fade = null;
    const first = this.createRenderer(this.level, {});
    this.ready =
      typeof first?.then === 'function'
        ? first.then((renderer) => this.#open(renderer))
        : Promise.resolve(this.#open(first));
  }

  /** The first lane; the length of the stream never changes after it. */
  #open(renderer) {
    this.lane = new Lane(renderer, this.streamRate, 0);
    this.duration = renderer.duration;
    this.totalSamples = Math.round(
      (renderer.totalSamples * this.streamRate) / renderer.sampleRate
    );
  }

  /** The renderer that is heard (the old one until a crossfade ends). */
  get renderer() {
    return this.lane?.renderer;
  }

  get done() {
    return this.lane !== null && this.position >= this.totalSamples;
  }

  /** True from an accepted setLevel until its crossfade ends. */
  get switching() {
    return this.request !== null || this.pending !== null;
  }

  /**
   * Ask for tier `level` from the next render on. Returns false (and
   * changes nothing) while a switch runs, for the current level, for a
   * tier whose rates give a switch grid below 20 Hz and, with a room, for
   * a higher level.
   * @param {number} level
   * @returns {boolean}
   */
  setLevel(level) {
    const tier = this.tiers[level];
    if (!tier || this.switching || level === this.level || !this.lane) {
      return false;
    }
    const grid = switchGrid(
      this.streamRate,
      this.lane.renderer.sampleRate,
      tier.sampleRate
    );
    if (grid < MIN_GRID || (this.room && level > this.level)) {
      return false;
    }
    this.request = level;
    return true;
  }

  /** Preroll (s) of a switch, with the room tail. */
  #preroll() {
    const tail = this.room ? (this.lane.renderer.listener?.tail ?? 0) : 0;
    return this.preroll + Math.min(MAX_ROOM_PREROLL, tail);
  }

  /** Start the requested switch, or drop it when it would end too late. */
  async #startSwitch() {
    const level = this.request;
    this.request = null;
    const old = this.lane;
    const oldRate = old.renderer.sampleRate;
    const grid = switchGrid(
      this.streamRate,
      oldRate,
      this.tiers[level].sampleRate
    );
    const step = oldRate / grid;
    const cut = Math.ceil(old.renderer.position / step) * step;
    const at = cut / oldRate;
    const preroll = this.#preroll();
    if (old.ended || at + preroll + this.overlap > this.duration) {
      return;
    }
    await old.renderTo(cut);
    if (old.renderer.position !== cut) {
      return;
    }
    const renderer = await this.createRenderer(level, { startTime: at });
    renderer.restoreSources(old.renderer.saveSources());
    const start = Math.round(at * this.streamRate);
    this.pending = {
      lane: new Lane(renderer, this.streamRate, start),
      from: this.level,
      level,
      at,
      fadeStart: start + Math.round(preroll * this.streamRate),
      length: Math.round(this.overlap * this.streamRate),
    };
  }

  /** Crossfade to the pending lane and make it the heard one. */
  async #finishSwitch() {
    const { lane, from, level, at, length } = this.pending;
    await lane.skipTo(this.position);
    const old = await this.lane.take(length);
    const next = await lane.take(length);
    const { samples, match, r } = crossfade(old, next, this.gain);
    this.fade = { samples, offset: 0 };
    this.gain = clamp(this.gain * match, MIN_MATCH, MAX_MATCH);
    this.lane.close();
    this.lane = lane;
    this.level = level;
    this.pending = null;
    this.switches.push({ at, from, level, gainDb: 20 * Math.log10(match), r });
  }

  /** Copy up to `count` lane samples times the gain into `target`. */
  async #fromLane(target, offset, count) {
    const samples = await this.lane.take(count);
    const { gain } = this;
    for (let index = 0; index < count; index++) {
      target[offset + index] =
        gain === 1 ? samples[index] : gain * samples[index];
    }
    return count;
  }

  /** Copy up to `count` crossfade samples into `target`. */
  #fromFade(target, offset, count) {
    const { samples } = this.fade;
    const length = Math.min(count, samples.length - this.fade.offset);
    target.set(
      samples.subarray(this.fade.offset, this.fade.offset + length),
      offset
    );
    this.fade.offset += length;
    if (this.fade.offset === samples.length) {
      this.fade = null;
    }
    return length;
  }

  /** The next samples while a switch is pending. */
  async #pendingSamples(target, offset, count) {
    const { fadeStart, lane } = this.pending;
    if (this.position >= fadeStart) {
      await this.#finishSwitch();
      return 0;
    }
    const length = Math.min(count, fadeStart - this.position);
    await this.#fromLane(target, offset, length);
    // The new lane's preroll: rendered alongside and dropped.
    await lane.skipTo(this.position + length);
    return length;
  }

  /**
   * Render the next samples of the stream into `target`.
   * @param {Float32Array} target
   * @returns {Promise<number>} Samples written (fewer at the end).
   */
  async render(target) {
    await this.ready;
    const count = Math.max(
      0,
      Math.min(target.length, this.totalSamples - this.position)
    );
    let written = 0;
    while (written < count) {
      if (this.request !== null && !this.pending && !this.fade) {
        await this.#startSwitch();
      }
      const left = count - written;
      let length;
      if (this.fade) {
        length = this.#fromFade(target, written, left);
      } else if (this.pending) {
        length = await this.#pendingSamples(target, written, left);
      } else {
        length = await this.#fromLane(target, written, left);
      }
      written += length;
      this.position += length;
    }
    return written;
  }

  /** Free the renderers. */
  close() {
    this.lane?.close();
    this.pending?.lane.close();
    this.pending = null;
    this.request = null;
  }
}
