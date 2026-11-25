/**
 * Main-thread side of the simulator. The articulation plan is computed
 * here (it is cheap) so the 3D view can animate in sync with the audio,
 * while the acoustic simulation runs in a worker. The animation clock
 * follows the audio output when sound is on and the wall clock otherwise.
 *
 * In automatic quality the worker changes the audio tier of a running
 * utterance (issue 29): a `tier` message says from which time on the
 * utterance is heard at another tier, and the HUD and the 3D view follow
 * when playback reaches that time. When the player runs dry the engine
 * tells the worker (`underrun`), which steps down without waiting.
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
/** Speech spans kept for duringSpeech. */
const SPEECH_SPANS = 16;
/** User input times kept for ownTask. */
const INPUT_TIMES = 64;
/**
 * A step down for load before this many seconds of the utterance counts as
 * an overload of the cached benchmark (issue 29, step 7).
 */
const OVERLOAD_SECONDS = 0.5;

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
    // Set while the benchmark waits for the answer to {type: 'engine'}.
    this.whenEngine = null;
    // Set while the benchmark waits for the end of an utterance.
    this.afterSpeech = null;
    // Times (performance.now) from each speak() to the end of its
    // utterance; the benchmark is paused then, so the long tasks of the app
    // in them are not the benchmark's (use-simulator, `?debug`).
    this.speechSpans = [];
    this.speechFrom = null;
    // Times (performance.now) of user input while the benchmark runs
    // (noteInput): a task that handled one is the app's, not the
    // benchmark's.
    this.inputTimes = [];
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

  #endSpeech() {
    if (this.speechFrom !== null) {
      this.speechSpans.push({
        from: this.speechFrom,
        to: globalThis.performance.now(),
      });
      this.speechSpans.splice(0, this.speechSpans.length - SPEECH_SPANS);
      this.speechFrom = null;
      this.afterSpeech?.();
    }
  }

  #emit(patch) {
    if (patch.phase === 'idle') {
      this.#endSpeech();
    }
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
    this.#postBenchmark(true);
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
        level: cached.level,
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

  /**
   * Start at the start level and measure at the next idle moment after the
   * worker has answered {type: 'engine'}: the benchmark needs the loaded
   * engine anyway, and the app's render of that answer would otherwise be
   * a long task inside the benchmark window. An utterance in progress
   * (its planning is on this thread) moves it to after the utterance.
   */
  #measureLater() {
    this.cached = null;
    this.benchmarkGpu = null;
    this.#setAutoLevel(startLevel(globalThis.navigator ?? {}));
    this.#emit({ audioLevel: this.audioLevel, benchmark: null });
    this.#scheduleBenchmark();
  }

  /**
   * Post the benchmark at the next idle moment after the engine answer and
   * after the utterance in progress, if any.
   */
  #scheduleBenchmark() {
    this.cancelIdle();
    let cancel = () => {};
    // An utterance is the user's: post after it, at the next idle moment.
    const post = () => {
      if (this.speechFrom === null) {
        this.#postBenchmark();
        return;
      }
      this.afterSpeech = () => {
        this.afterSpeech = null;
        cancel = this.idle(post);
      };
    };
    this.whenEngine = () => {
      this.whenEngine = null;
      cancel = this.idle(post);
    };
    this.cancelIdle = () => {
      this.whenEngine = null;
      this.afterSpeech = null;
      cancel();
    };
    if (this.status.engine) {
      this.whenEngine();
    }
  }

  /**
   * Post the benchmark to the worker. `notify`: re-render the app now (the
   * "Measure again" button); the silent load-time run does not, since a
   * render of the app at 4x CPU throttling is a long task of its own; its
   * answer renders.
   */
  #postBenchmark(notify = false) {
    this.cancelIdle = () => {};
    const benchmark = {
      measuring: true,
      from: globalThis.performance.now(),
      to: null,
      time: null,
      engine: null,
      cached: false,
    };
    if (notify) {
      this.#emit({ benchmark });
    } else {
      this.status = { ...this.status, benchmark };
    }
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
        level: message.version !== undefined ? message.level : undefined,
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
   * Whether the time from `start` to `end` (performance.now) overlaps an
   * utterance: from speak() to its end, or still speaking.
   */
  duringSpeech(start, end) {
    const open =
      this.speechFrom === null ? [] : [{ from: this.speechFrom, to: Infinity }];
    return [...this.speechSpans, ...open].some(
      (span) => start <= span.to && end >= span.from
    );
  }

  /**
   * Note user input (a pointer or key event) at `time` (performance.now),
   * while the benchmark is being measured; see ownTask.
   */
  noteInput(time = globalThis.performance.now()) {
    const span = this.status.benchmark;
    if (span?.from === null || span?.from === undefined || span.to !== null) {
      return;
    }
    this.inputTimes.push(time);
    this.inputTimes.splice(0, this.inputTimes.length - INPUT_TIMES);
  }

  /**
   * Whether a main-thread task from `start` to `end` (performance.now) is
   * the app's own work, not the benchmark's: it overlaps an utterance
   * (duringSpeech) or handled user input (noteInput). The `?debug` long
   * tasks leave these out (use-simulator).
   */
  ownTask(start, end) {
    return (
      this.duringSpeech(start, end) ||
      this.inputTimes.some((time) => time >= start && time <= end)
    );
  }

  /**
   * Speak text.
   * @param {{text: string, lang: string, accent?: string, accentLevel?: number, weakForms?: boolean, head: object, seed: string, mode: 'both'|'sound'|'visual', ipa?: boolean, microphone?: object, room?: string, enclosure?: object, gpu?: boolean, engine?: 'auto'|'rust'|'js', breaths?: boolean, source?: 'lf'|'folds', interaction?: boolean, subglottal?: boolean, headroom?: number}} request
   *   `microphone`, `room` and `enclosure` are the listening settings;
   *   `accentLevel`, `weakForms`, `breaths`, `source`, `interaction`,
   *   `subglottal` and `headroom` the voice settings (see synthesize).
   */
  async speak(request) {
    this.stop();
    this.speechFrom ??= globalThis.performance.now();
    try {
      return await this.#speak(request);
    } catch (error) {
      if (this.status.phase !== 'speaking') {
        this.#endSpeech();
      }
      throw error;
    }
  }

  async #speak(request) {
    const transcription = request.ipa
      ? { lang: request.lang, ipa: request.text, words: [] }
      : await this.#transcribe(request);
    // The worker plans the same utterance again: breaths change its timing.
    const plan = planUtterance(transcription.ipa, {
      head: request.head,
      language: transcription.lang,
      articulationOffsets: request.articulationOffsets,
      breaths: Boolean(request.breaths),
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
      requiresCopyConsent: request.requiresCopyConsent,
      startedAt: null,
      fields: [],
      fieldIndex: 0,
      // Tier switches not yet reached by playback, and underruns reported.
      tiers: [],
      underruns: 0,
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
      switches: 0,
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
      articulationOffsets: request.articulationOffsets,
      seed: request.seed,
      tier: this.audioLevel,
      auto: this.auto,
      streamRate: this.player.context?.sampleRate,
      microphone: request.microphone,
      room: request.room,
      enclosure: request.enclosure,
      gpu: this.#gpu(request),
      engine: request.engine ?? this.engineName,
      breaths: Boolean(request.breaths),
      source: request.source,
      interaction: request.interaction,
      subglottal: request.subglottal,
      headroom: request.headroom,
    });
    return job;
  }

  /**
   * Text to IPA with the full lexicons of the languages in the text: a
   * lexicon found for the first time means the text is read again.
   */
  async #transcribe(request) {
    const read = () =>
      textToIpa(request.text, {
        lang: request.lang,
        accent: request.accent,
        accentLevel: request.accentLevel,
        weakForms: request.weakForms,
      });
    const first = read();
    if (request.requiresCopyConsent) {
      return first;
    }
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
      this.whenEngine?.();
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
      tier: () => this.#tier(job, message),
      end: () => {
        if (this.auto && message.level !== undefined) {
          this.governor.level = message.level;
        }
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
   * The worker switched the tier of the running utterance from `at`
   * seconds on: the next utterance starts there, and the HUD and the 3D
   * view follow when playback reaches `at` (see #reach).
   */
  #tier(job, message) {
    if (this.auto) {
      this.governor.level = message.level;
    }
    job.tiers.push(message);
    if (message.reason === 'load' && message.at < OVERLOAD_SECONDS) {
      // Too slow from the start: an overload of the cached tier (issue 28).
      this.#countOverloads(job, true);
    }
    this.#emit({ switches: (this.status.switches ?? 0) + 1 });
  }

  /** Apply the tier switches playback has reached. */
  #reach(job, time) {
    while (job.tiers.length > 0 && job.tiers[0].at <= time) {
      const { level, solver, gpu, model } = job.tiers.shift();
      job.solver = solver;
      this.cells = model ?? null;
      this.#emit({
        audioLevel: level,
        solver: gpu ? `${solver} · GPU` : solver,
        cells: Boolean(model),
      });
    }
  }

  /**
   * Tell the worker when the player ran dry while the utterance is still
   * rendering: in automatic quality it steps down without waiting.
   */
  #underruns(job) {
    const count = this.player.underruns ?? 0;
    if (count > job.underruns && this.auto && !job.finished) {
      this.worker?.postMessage({ type: 'underrun', id: job.id });
    }
    job.underruns = Math.max(job.underruns, count);
  }

  /**
   * Overloads in a row of utterances started at the cached level: the
   * third drops the cache and measures again at the next idle moment after
   * the utterance. An utterance at that level without one starts the count
   * again.
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
    this.#scheduleBenchmark();
  }

  /** WebGPU failed: the worker restarts the utterance on the CPU. */
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
    job.tiers = [];
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
    this.#underruns(job);
    this.#emit({ audioLoad: load, underruns: this.player.underruns });
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
    if (job.sound) {
      this.#underruns(job);
    }
    if (job.sound && this.player.underruns !== this.status.underruns) {
      // The worklet counts underruns while it plays, after the last chunk.
      this.#emit({
        underruns: this.player.underruns,
        audioMode: this.player.mode,
      });
    }
    const time = this.#time(job) ?? 0;
    this.#reach(job, time);
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

  get recordingRequiresCopyConsent() {
    return Boolean((this.job ?? this.lastJob)?.requiresCopyConsent);
  }

  /**
   * The last utterance as a file in an export preset (see audio-export.js).
   * @param {string} [preset] Default 16-bit WAV.
   * @returns {{blob: Blob, fileName: string} | null}
   */
  exportAudio(preset, { copyConsent = false } = {}) {
    if (this.recordingRequiresCopyConsent && !copyConsent) {
      return null;
    }
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
