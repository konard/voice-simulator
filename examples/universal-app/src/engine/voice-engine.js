/**
 * Main-thread side of the simulator. The articulation plan is computed
 * here (it is cheap) so the 3D view can animate in sync with the audio,
 * while the acoustic simulation runs in a worker. The animation clock
 * follows the audio output when sound is on and the wall clock otherwise.
 */

import {
  AUDIO_TIERS,
  LodGovernor,
  planUtterance,
  sampleState,
  textToIpa,
  utteranceTimeline,
} from '../../../../src/index.js';
import { exportAudio } from './audio-export.js';
import { AudioPlayer } from './audio-player.js';
import { readyToPlay, secondsToPlay } from './render-ahead.js';

const TAIL = 0.15;
const BENCHMARK_KEY = 'voice-simulator:benchmark';

/**
 * Identifies the device, build and backends (whether WebGPU may be used)
 * a cached benchmark belongs to.
 */
function deviceKey(allowGpu) {
  const navigator = globalThis.navigator ?? {};
  return [
    navigator.userAgent ?? '',
    navigator.hardwareConcurrency ?? 0,
    AUDIO_TIERS.map((tier) => `${tier.name}:${tier.cost}`).join(','),
    allowGpu ? 'gpu' : 'cpu',
  ].join('|');
}

function readCachedBenchmark(allowGpu) {
  try {
    const cached = JSON.parse(
      globalThis.localStorage?.getItem(BENCHMARK_KEY) ?? 'null'
    );
    return cached?.device === deviceKey(allowGpu) ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedBenchmark({ level, loads, gpu }, allowGpu) {
  try {
    globalThis.localStorage?.setItem(
      BENCHMARK_KEY,
      JSON.stringify({ device: deviceKey(allowGpu), level, loads, gpu })
    );
  } catch {
    // Storage may be unavailable (private mode); the cache is optional.
  }
}

export class VoiceEngine {
  /**
   * @param {{onChange?: (status: object) => void, createWorker?: () => Worker}} [options]
   */
  constructor(options = {}) {
    this.onChange = options.onChange ?? (() => {});
    this.createWorker =
      options.createWorker ??
      (() =>
        new Worker(new URL('./synth-worker.js', import.meta.url), {
          type: 'module',
        }));
    this.worker = null;
    this.player = new AudioPlayer();
    this.governor = new LodGovernor({
      tiers: AUDIO_TIERS,
      level: 0,
      target: 0.8,
      dwell: 40,
    });
    this.auto = true;
    this.fixedLevel = 0;
    // Whether the benchmark may use WebGPU, and whether its choice runs there.
    this.allowGpu = true;
    this.benchmarkGpu = null;
    this.nextId = 1;
    this.job = null;
    this.state = {};
    this.cells = null;
    this.status = {
      phase: 'idle',
      audioLevel: 0,
      audioLoad: 0,
      loads: [],
      underruns: 0,
      error: null,
    };
  }

  #emit(patch) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }

  #ensureWorker() {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.addEventListener('message', (event) =>
        this.#handle(event.data)
      );
      this.worker.addEventListener('error', (event) => {
        this.#emit({ phase: 'idle', error: event.message ?? 'Worker error' });
      });
    }
    return this.worker;
  }

  /**
   * Measure the audio tiers on this device (runs in the worker), the 3D
   * ones on WebGPU too unless `gpu` is false. A result cached by an earlier
   * visit on the same device applies at once, and the fresh measurement
   * replaces it when it arrives.
   * @param {object} head
   * @param {{gpu?: boolean}} [options]
   */
  benchmark(head, options = {}) {
    this.allowGpu = options.gpu !== false;
    const cached = readCachedBenchmark(this.allowGpu);
    this.benchmarkGpu = cached ? Boolean(cached.gpu) : null;
    if (cached) {
      this.governor.level = Math.min(cached.level, AUDIO_TIERS.length - 1);
      this.#emit({
        loads: cached.loads,
        audioLevel: this.audioLevel,
        cachedBenchmark: true,
      });
    } else {
      this.#emit({ phase: 'benchmark' });
    }
    this.#ensureWorker().postMessage({
      type: 'benchmark',
      head,
      gpu: this.allowGpu,
    });
  }

  /** Use a fixed audio tier (index) or `null` for automatic selection. */
  setTier(level) {
    this.auto = level === null;
    if (!this.auto) {
      this.fixedLevel = level;
    }
    this.#emit({ audioLevel: this.audioLevel });
  }

  get audioLevel() {
    return this.auto ? this.governor.level : this.fixedLevel;
  }

  /**
   * Speak text.
   * @param {{text: string, lang: string, accent?: string, head: object, seed: string, mode: 'both'|'sound'|'visual', ipa?: boolean, microphone?: object, room?: string, enclosure?: object, gpu?: boolean}} request
   *   `microphone`, `room` and `enclosure` are the listening settings
   *   (see synthesize).
   */
  async speak(request) {
    this.stop();
    const transcription = request.ipa
      ? { lang: request.lang, ipa: request.text, words: [] }
      : textToIpa(request.text, { lang: request.lang, accent: request.accent });
    const plan = planUtterance(transcription.ipa, {
      head: request.head,
      language: transcription.lang,
    });
    const timeline = utteranceTimeline(plan, {
      words: transcription.words,
      ipa: transcription.ipa,
      language: transcription.lang,
    });
    const id = this.nextId++;
    const job = {
      id,
      plan,
      timeline,
      sound: request.mode !== 'visual',
      startedAt: null,
      fields: [],
      fieldIndex: 0,
      chunks: [],
      sampleRate: 0,
      totalSamples: 0,
      rendered: 0,
      busy: 0,
      playing: false,
      finished: false,
    };
    this.job = job;
    this.state = {};
    this.#emit({
      phase: 'speaking',
      error: null,
      ipa: transcription.ipa,
      lang: transcription.lang,
      text: request.text,
      timeline,
      utterance: id,
      underruns: 0,
      rendering: null,
    });
    if (!job.sound) {
      job.startedAt = globalThis.performance.now();
      return job;
    }
    await this.player.unlock();
    if (this.job !== job) {
      return job;
    }
    this.#ensureWorker().postMessage({
      type: 'speak',
      id,
      ipa: transcription.ipa,
      lang: transcription.lang,
      head: request.head,
      seed: request.seed,
      tier: this.audioLevel,
      auto: this.auto,
      microphone: request.microphone,
      room: request.room,
      enclosure: request.enclosure,
      gpu: this.#gpu(request),
    });
    return job;
  }

  /**
   * Whether the 3D tiers of a request may run on WebGPU: not when the
   * request says so, nor in automatic mode when the benchmark found the
   * CPU faster.
   */
  #gpu(request) {
    if (request.gpu === false || (this.auto && this.benchmarkGpu === false)) {
      return false;
    }
    return request.gpu;
  }

  #handle(message) {
    if (message.type === 'benchmark') {
      writeCachedBenchmark(message, this.allowGpu);
      this.benchmarkGpu = Boolean(message.gpu);
      this.governor.level = message.level;
      this.#emit({
        phase: this.job ? 'speaking' : 'idle',
        loads: message.loads,
        audioLevel: this.audioLevel,
        audioLoad: message.loads[message.level] ?? 0,
      });
      return;
    }
    const job = this.job;
    if (!job || message.id !== job.id) {
      return;
    }
    const handlers = {
      start: () => this.#start(job, message),
      chunk: () => this.#chunk(job, message),
      overload: () => this.#overload(job, message),
      end: () => {
        job.finished = true;
        this.#play(job);
      },
      error: () => {
        this.#emit({ error: message.message });
        this.stop();
      },
    };
    handlers[message.type]?.();
  }

  #start(job, message) {
    job.sampleRate = message.sampleRate;
    job.totalSamples = message.totalSamples;
    job.solver = message.solver;
    this.cells = message.model;
    this.player.begin(message.sampleRate);
    this.#emit({
      solver: message.gpu ? `${message.solver} · GPU` : message.solver,
      cells: Boolean(message.model),
    });
  }

  /** The worker restarts the utterance on a cheaper tier. */
  #overload(job, message) {
    this.governor.level = message.level;
    this.governor.load = 0;
    this.governor.samples = 0;
    job.chunks = [];
    job.fields = [];
    job.fieldIndex = 0;
    job.rendered = 0;
    job.busy = 0;
    this.#emit({
      audioLevel: this.audioLevel,
      audioLoad: message.load,
      overloads: (this.status.overloads ?? 0) + 1,
    });
  }

  #chunk(job, message) {
    const { start, samples, field, load } = message;
    job.chunks.push({ start, samples });
    job.rendered = Math.max(job.rendered, start + samples.length);
    job.busy += (load * samples.length) / job.sampleRate;
    if (job.playing) {
      this.player.push(start, samples);
    } else if (
      readyToPlay({
        rendered: job.rendered,
        total: job.totalSamples,
        busy: job.busy,
        sampleRate: job.sampleRate,
      })
    ) {
      this.#play(job);
    } else {
      this.#emit({
        rendering: {
          progress: job.rendered / Math.max(1, job.totalSamples),
          wait: secondsToPlay({
            rendered: job.rendered,
            total: job.totalSamples,
            busy: job.busy,
            sampleRate: job.sampleRate,
          }),
        },
      });
    }
    if (field) {
      job.fields.push({
        end: (start + samples.length) / job.sampleRate,
        field,
      });
    }
    if (this.auto) {
      // Governor changes apply to the next utterance.
      this.governor.record(load, 1);
    }
    this.#emit({
      audioLoad: this.auto ? this.governor.load : load,
      underruns: this.player.underruns,
    });
  }

  /**
   * Start playback with everything rendered so far; later chunks play as
   * they arrive (see render-ahead.js).
   */
  #play(job) {
    if (job.playing || !job.sound) {
      return;
    }
    job.playing = true;
    for (const { start, samples } of job.chunks) {
      this.player.push(start, samples);
    }
    this.#emit({ rendering: null });
  }

  /** Current time in the utterance (seconds), or null before audio starts. */
  #time(job) {
    if (!job.sound) {
      return (globalThis.performance.now() - job.startedAt) / 1000;
    }
    return this.player.time();
  }

  #field(job, time) {
    const { fields } = job;
    while (
      job.fieldIndex < fields.length - 1 &&
      fields[job.fieldIndex].end < time
    ) {
      fields[job.fieldIndex].field = null;
      job.fieldIndex++;
    }
    return fields[job.fieldIndex]?.field ?? null;
  }

  /**
   * Animation frame: articulator state, time, pressure field and the word
   * and syllable timeline of the utterance.
   * @returns {{speaking: boolean, time: number, state: object, field: object|null, plan: object|null, timeline: object|null}}
   */
  frame() {
    const job = this.job;
    if (!job) {
      return {
        speaking: false,
        time: 0,
        state: {},
        field: null,
        plan: null,
        timeline: null,
      };
    }
    if (job.sound && this.player.stalled()) {
      // The audio clock stopped (e.g. the output device went away while
      // the tab was in the background): continue on a fresh context.
      this.player.recover(job.chunks);
      this.#emit({ audioRecoveries: this.player.recoveries });
    }
    const time = this.#time(job) ?? 0;
    const clamped = Math.max(0, Math.min(job.plan.duration, time));
    sampleState(job.plan, clamped, this.state);
    const field = this.#field(job, clamped);
    // The audio can outlast the speech (microphone delay, reverberation).
    const audioEnd = job.sampleRate ? job.totalSamples / job.sampleRate : 0;
    const end = Math.max(job.plan.duration + TAIL, audioEnd);
    if (time > end && (!job.sound || job.finished)) {
      this.job = null;
      this.lastJob = job;
      this.#emit({ phase: 'idle', audioLevel: this.audioLevel });
    }
    return {
      speaking: true,
      time: clamped,
      state: this.state,
      field,
      plan: job.plan,
      timeline: job.timeline,
    };
  }

  stop() {
    if (this.job) {
      this.worker?.postMessage({ type: 'cancel', id: this.job.id });
      this.lastJob = this.job;
      this.job = null;
    }
    this.player.stop();
    if (this.status.phase === 'speaking') {
      this.#emit({
        phase: 'idle',
        audioLevel: this.audioLevel,
        rendering: null,
      });
    }
  }

  /** Samples of the last (or current) utterance, or null. */
  recording() {
    const job = this.job ?? this.lastJob;
    if (!job || job.chunks.length === 0) {
      return null;
    }
    const length = Math.max(
      ...job.chunks.map((chunk) => chunk.start + chunk.samples.length)
    );
    const samples = new Float32Array(length);
    for (const chunk of job.chunks) {
      samples.set(chunk.samples, chunk.start);
    }
    return { samples, sampleRate: job.sampleRate };
  }

  /**
   * The last utterance as a file in an export preset (see audio-export.js).
   * @param {string} [preset] Default 16-bit WAV.
   * @returns {{blob: Blob, fileName: string} | null}
   */
  exportAudio(preset) {
    const recording = this.recording();
    return recording
      ? exportAudio(recording.samples, recording.sampleRate, preset)
      : null;
  }

  /** WAV file of the last (or current) utterance, or null. */
  wav() {
    return this.exportAudio()?.blob ?? null;
  }

  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
