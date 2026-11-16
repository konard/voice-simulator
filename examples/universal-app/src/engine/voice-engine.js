/**
 * Main-thread side of the simulator. The articulation plan is computed
 * here (it is cheap) so the 3D view can animate in sync with the audio,
 * while the acoustic simulation runs in a worker. The animation clock
 * follows the audio output when sound is on and the wall clock otherwise.
 */

import {
  AUDIO_TIERS,
  BASE_AUDIO_LEVEL,
  LodGovernor,
  audioTierIndex,
  batteryLevelCap,
  planUtterance,
  sampleState,
  startLevel,
  textToIpa,
  utteranceTimeline,
} from '../../../../src/index.js';
import { exportAudio } from './audio-export.js';
import {
  OVERLOADS_TO_MEASURE,
  clearCachedBenchmark,
  readCachedBenchmark,
  readOverloads,
  readTierSetting,
  sameEngine,
  whenIdle,
  writeCachedBenchmark,
  writeOverloads,
  writeTierSetting,
} from './benchmark-cache.js';
import { fullLexiconLoader } from './full-lexicons.js';
import { WorkletPlayer } from './worklet-player.js';
import { readyToPlay, secondsToPlay } from './render-ahead.js';

const TAIL = 0.15;

export class VoiceEngine {
  /**
   * @param {{onChange?: (status: object) => void, createWorker?: () => Worker, loadLexicon?: (lang: string) => Promise<object|null>, idle?: (run: () => void) => () => void}} [options]
   *   `loadLexicon` gives the full lexicon of a language (default: the
   *   file `lexicons/<lang>-full.json` next to the page, when it exists);
   *   `idle` runs the device benchmark at an idle moment of a visible page
   *   and returns a cancel function (default whenIdle)
   */
  constructor(options = {}) {
    this.onChange = options.onChange ?? (() => {});
    this.addFullLexicons = fullLexiconLoader(options.loadLexicon);
    this.createWorker =
      options.createWorker ??
      (() =>
        new Worker(new URL('./synth-worker.js', import.meta.url), {
          type: 'module',
        }));
    this.worker = null;
    this.player = new WorkletPlayer();
    this.governor = new LodGovernor({
      tiers: AUDIO_TIERS,
      level: BASE_AUDIO_LEVEL,
      target: 0.8,
      dwell: 40,
    });
    // The quality setting of an earlier visit: 'auto' or a tier name.
    const tier = readTierSetting();
    this.auto = tier === 'auto';
    this.fixedLevel = this.auto ? BASE_AUDIO_LEVEL : audioTierIndex(tier);
    // Whether the benchmark may use WebGPU, and whether its choice runs there.
    this.allowGpu = true;
    this.benchmarkGpu = null;
    // The device benchmark (issue 28): the cached result in use, the head
    // to measure with and the cancel function of a scheduled measurement.
    this.idle = options.idle ?? whenIdle;
    this.cached = null;
    this.benchmarkHead = undefined;
    this.cancelIdle = () => {};
    // The engine setting ('auto', 'rust' or 'js') the worker renders with.
    this.engineName = 'auto';
    this.nextId = 1;
    this.job = null;
    this.state = {};
    this.cells = null;
    this.status = {
      phase: 'idle',
      audioLevel: BASE_AUDIO_LEVEL,
      audioLoad: 0,
      loads: [],
      underruns: 0,
      error: null,
      // The worker's answer to {type: 'engine'}: {name, simd, threads,
      // reason, error}.
      engine: null,
      // The device benchmark: {measuring, from, to, time, engine, cached}
      // (`from`/`to`: performance.now() of the request and of its answer;
      // `time`: Date.now() of the measurement), null before one.
      benchmark: null,
    };
    this.#watchBattery();
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
      this.#askEngine();
    }
    return this.worker;
  }

  /** Ask the worker which engine renders (the reply sets status.engine). */
  #askEngine() {
    this.worker.postMessage({ type: 'engine', engine: this.engineName });
  }

  /**
   * Render with another engine: 'auto' (Rust where it loads, else
   * JavaScript), 'rust' or 'js'.
   * @param {'auto'|'rust'|'js'} name
   */
  setEngine(name) {
    if (name === this.engineName) {
      return;
    }
    this.engineName = name;
    this.#emit({ engine: null });
    if (this.worker) {
      this.#askEngine();
    }
  }

  /**
   * Choose the automatic audio tier for this device: the result of an
   * earlier visit when it is valid (same benchmark version, device, engine
   * setting and engine, younger than 30 days; see benchmark-cache.js),
   * else the start level (startLevel) now and the silent device benchmark
   * of the worker at the next idle moment of a visible page. The 3D tiers
   * are measured on WebGPU too unless `gpu` is false.
   * @param {object} head
   * `engine` is the engine setting (see setEngine).
   * @param {{gpu?: boolean, engine?: 'auto'|'rust'|'js'}} [options]
   */
  benchmark(head, options = {}) {
    this.allowGpu = options.gpu !== false;
    this.setEngine(options.engine ?? this.engineName);
    this.benchmarkHead = head;
    this.cancelIdle();
    this.#ensureWorker();
    const cached = readCachedBenchmark(this.allowGpu, this.engineName);
    if (cached) {
      this.#useCache(cached);
    } else {
      this.#measureLater();
    }
  }

  /** Forget the cached benchmark and measure this device now. */
  measureAgain() {
    clearCachedBenchmark();
    this.cancelIdle();
    this.cached = null;
    this.#postBenchmark();
  }

  #useCache(cached) {
    this.cached = cached;
    this.benchmarkGpu = Boolean(cached.gpu);
    this.#setAutoLevel(cached.level);
    this.#emit({
      loads: cached.loads,
      audioLevel: this.audioLevel,
      benchmark: {
        measuring: false,
        from: null,
        to: null,
        time: cached.time,
        engine: cached.engine,
        cached: true,
      },
    });
    this.#checkCachedEngine();
  }

  /**
   * A cached benchmark of another engine than the one the worker renders
   * with (another build, SIMD or threads) is measured again.
   */
  #checkCachedEngine() {
    const answer = this.status.engine;
    if (this.cached && answer && !sameEngine(this.cached.engine, answer)) {
      this.#measureLater();
    }
  }

  /** Start at the start level and measure at the next idle moment. */
  #measureLater() {
    this.cached = null;
    this.benchmarkGpu = null;
    this.#setAutoLevel(startLevel(globalThis.navigator ?? {}));
    this.#emit({ audioLevel: this.audioLevel, benchmark: null });
    this.cancelIdle();
    this.cancelIdle = this.idle(() => this.#postBenchmark());
  }

  #postBenchmark() {
    this.cancelIdle = () => {};
    this.#emit({
      benchmark: {
        measuring: true,
        from: globalThis.performance.now(),
        to: null,
        time: null,
        engine: null,
        cached: false,
      },
    });
    this.#ensureWorker().postMessage({
      type: 'benchmark',
      head: this.benchmarkHead,
      gpu: this.allowGpu,
      engine: this.engineName,
    });
  }

  /**
   * The worker's benchmark: the CPU answer, then (with `gpuPending`) the
   * one with the 3D tiers on WebGPU. The last one is cached.
   */
  #benchmarkAnswer(message) {
    this.benchmarkGpu = Boolean(message.gpu);
    this.#setAutoLevel(message.level);
    const final = !message.gpuPending;
    if (final && message.version !== undefined) {
      this.cached = writeCachedBenchmark(
        message,
        this.allowGpu,
        this.engineName
      );
    }
    const previous = this.status.benchmark;
    this.#emit({
      loads: message.loads,
      audioLevel: this.audioLevel,
      audioLoad: message.loads[message.level] ?? 0,
      benchmark: {
        measuring: !final,
        from: previous?.from ?? null,
        to: previous?.to ?? globalThis.performance.now(),
        time: final && message.version !== undefined ? Date.now() : null,
        engine: message.engine ?? null,
        cached: false,
      },
    });
  }

  /** The automatic level, at most the battery's cap. */
  #setAutoLevel(level) {
    this.governor.level = Math.max(
      0,
      Math.min(level, this.governor.maxLevel, AUDIO_TIERS.length - 1)
    );
  }

  /**
   * A battery that is not charging and below 20 % caps automatic quality
   * at `medium` (batteryLevelCap).
   */
  #watchBattery() {
    const navigator = globalThis.navigator;
    if (typeof navigator?.getBattery !== 'function') {
      return;
    }
    navigator
      .getBattery()
      .then((battery) => {
        const update = () => {
          this.governor.maxLevel = batteryLevelCap(battery);
          this.#setAutoLevel(this.governor.level);
          this.#emit({ audioLevel: this.audioLevel });
        };
        update();
        battery.addEventListener?.('levelchange', update);
        battery.addEventListener?.('chargingchange', update);
      })
      .catch(() => {});
  }

  /** Use a fixed audio tier (index) or `null` for automatic selection. */
  setTier(level) {
    this.auto = level === null;
    if (!this.auto) {
      this.fixedLevel = level;
    }
    // Kept for the next visit; the benchmark still runs, but only the
    // automatic level follows it.
    writeTierSetting(this.auto ? 'auto' : AUDIO_TIERS[level].name);
    this.#emit({ audioLevel: this.audioLevel });
  }

  get audioLevel() {
    return this.auto ? this.governor.level : this.fixedLevel;
  }

  /**
   * Speak text.
   * @param {{text: string, lang: string, accent?: string, head: object, seed: string, mode: 'both'|'sound'|'visual', ipa?: boolean, microphone?: object, room?: string, enclosure?: object, gpu?: boolean, engine?: 'auto'|'rust'|'js'}} request
   *   `microphone`, `room` and `enclosure` are the listening settings
   *   (see synthesize).
   */
  async speak(request) {
    this.stop();
    const transcription = request.ipa
      ? { lang: request.lang, ipa: request.text, words: [] }
      : await this.#transcribe(request);
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
      level: this.audioLevel,
      auto: this.auto,
      overloaded: false,
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
    this.#emit({ audioMode: this.player.mode });
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
      engine: request.engine ?? this.engineName,
    });
    return job;
  }

  /**
   * Text to IPA with the full lexicons of the languages in the text: a
   * lexicon found for the first time means the text is read again.
   */
  async #transcribe(request) {
    const read = () =>
      textToIpa(request.text, { lang: request.lang, accent: request.accent });
    const first = read();
    const langs = [first.lang, ...first.words.map((word) => word.lang)];
    const added = await this.addFullLexicons(langs);
    return added.length > 0 ? read() : first;
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
    if (message.type === 'engine') {
      const { name, simd, threads, reason, error } = message;
      this.#emit({
        engine: { name, simd, threads, reason, error: error ?? null },
      });
      this.#checkCachedEngine();
      return;
    }
    if (message.type === 'benchmark') {
      this.#benchmarkAnswer(message);
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
        this.#countOverloads(job, false);
        this.#play(job);
        if (job.sound) {
          // The player plays what it still holds, then silence.
          this.player.end();
        }
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

  /**
   * Overloads in a row of utterances started at the cached level: the
   * third drops the cache, so the next visit measures again. An utterance
   * at that level without one starts the count again.
   */
  #countOverloads(job, overloaded) {
    if (!job.auto || !this.cached || job.level !== this.cached.level) {
      return;
    }
    if (!overloaded) {
      if (!job.overloaded) {
        writeOverloads(0);
      }
      return;
    }
    if (job.overloaded) {
      return;
    }
    job.overloaded = true;
    const count = readOverloads() + 1;
    if (count < OVERLOADS_TO_MEASURE) {
      writeOverloads(count);
      return;
    }
    clearCachedBenchmark();
    this.cached = null;
    this.#emit({ benchmark: null });
  }

  /** The worker restarts the utterance on a cheaper tier. */
  #overload(job, message) {
    if (message.from === job.level) {
      this.#countOverloads(job, true);
    }
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
    if (job.sound && this.player.underruns !== this.status.underruns) {
      // The worklet counts underruns while it plays, after the last chunk.
      this.#emit({
        underruns: this.player.underruns,
        audioMode: this.player.mode,
      });
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
    this.cancelIdle();
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
