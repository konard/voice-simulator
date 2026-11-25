import { mergeResults } from '../components/recognition-timeline.js';

// The session keeps at most this much of a microphone input to download.
export const MAX_KEPT_SECONDS = 120;
// Seconds of audio per input level update.
const LEVEL_SECONDS = 0.1;

const initialStatus = () => ({
  state: 'idle',
  // RMS of the latest 100 ms of input in dBFS, while running (issue 170).
  inputLevel: null,
  result: mergeResults([], null),
  committedWords: 0,
  lastSyllable: null,
  error: null,
});

export class RecognitionSession {
  #worker = null;
  #job = null;
  #last = null;
  #nextId = 1;

  constructor({
    createWorker = () =>
      new Worker(new URL('./recognition-worker.js', import.meta.url), {
        type: 'module',
      }),
    onChange = () => {},
  } = {}) {
    this.createWorker = createWorker;
    this.onChange = onChange;
    this.status = initialStatus();
  }

  // Load the static worker modules with the page. Starting a file only sends
  // messages to this worker, including when the browser is offline.
  preload() {
    try {
      this.#prepare();
    } catch {
      // A failed speculative load is retried and reported when starting.
    }
  }

  #prepare() {
    if (!this.#worker) {
      const worker = this.createWorker();
      worker.addEventListener('message', ({ data }) => {
        if (this.#worker === worker) {
          this.#receive(data);
        }
      });
      worker.addEventListener('error', (error) => {
        if (this.#worker === worker) {
          worker.terminate();
          this.#worker = null;
          this.#fail(this.#job, error);
        }
      });
      this.#worker = worker;
    }
  }

  /**
   * Recognize a microphone or decoded samples. `keep: false` does not keep
   * the input for recording() (audio of a copied voice).
   */
  async start(source, options = {}, { keep = true } = {}) {
    this.reset();
    const job = {
      id: this.#nextId++,
      finals: [],
      offset: 0,
      options,
      keep,
      kept: [],
      keptLength: 0,
      level: { sum: 0, count: 0 },
    };
    this.#job = job;
    this.#last = job;
    this.#emit({ state: 'asking' });
    try {
      const input = await source;
      if (this.#job !== job) {
        return;
      }
      if (typeof input.start === 'function') {
        job.microphone = input;
        await input.start({
          onChunk: (samples, sampleRate) => {
            if (this.#job === job && !job.stopping) {
              this.#begin(job, sampleRate);
              this.#keep(job, samples);
              this.#measure(job, samples);
              this.#post(job, { type: 'chunk', samples }, [samples.buffer]);
            }
          },
          onError: (error) => this.#fail(job, error),
        });
      } else {
        job.file = input.samples;
        job.sampleRate = input.sampleRate;
        job.stride = Math.max(1, Math.floor(input.sampleRate * 0.02));
      }
      if (this.#job === job) {
        this.#begin(job, input.sampleRate);
        if (job.file) {
          this.#sendMore(job);
        }
      }
    } catch (error) {
      this.#fail(job, error);
    }
  }

  stop() {
    const job = this.#job;
    if (!job || job.stopping) {
      return;
    }
    if (!job.started) {
      this.reset();
      return;
    }
    job.stopping = true;
    this.#releaseMicrophone(job);
    this.#post(job, { type: 'stop' });
  }

  /** Whether recording() has samples to give. */
  get recorded() {
    const job = this.#last;
    return Boolean(
      job?.keep && job.sampleRate && (job.file?.length || job.keptLength)
    );
  }

  /** The input of the last session as {samples, sampleRate}, or null. */
  recording() {
    const job = this.#last;
    if (!job?.keep || !job.sampleRate) {
      return null;
    }
    if (job.file) {
      return { samples: job.file, sampleRate: job.sampleRate };
    }
    if (!job.keptLength) {
      return null;
    }
    const samples = new Float32Array(job.keptLength);
    let offset = 0;
    for (const chunk of job.kept) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return { samples, sampleRate: job.sampleRate };
  }

  reset() {
    this.#discard();
    this.#emit(initialStatus());
  }

  dispose() {
    this.#discard();
    this.#worker?.terminate();
    this.#worker = null;
  }

  #keep(job, samples) {
    if (!job.keep) {
      return;
    }
    job.kept.push(samples.slice());
    job.keptLength += samples.length;
    const limit = MAX_KEPT_SECONDS * job.sampleRate;
    while (job.keptLength - job.kept[0].length >= limit) {
      job.keptLength -= job.kept.shift().length;
    }
  }

  #measure(job, samples) {
    const { level } = job;
    for (const sample of samples) {
      level.sum += sample * sample;
    }
    level.count += samples.length;
    if (level.count >= LEVEL_SECONDS * job.sampleRate) {
      const rms = Math.sqrt(level.sum / level.count);
      level.sum = 0;
      level.count = 0;
      this.#emit({
        inputLevel: Math.max(-100, 20 * Math.log10(rms || 1e-5)),
      });
    }
  }

  #begin(job, sampleRate) {
    job.sampleRate ??= sampleRate;
    if (!job.started) {
      this.#prepare();
      job.started = true;
      this.#post(job, {
        type: 'start',
        sampleRate,
        sampleCount: job.file?.length,
        ...job.options,
      });
      this.#emit({ state: 'running' });
    }
  }

  #sendMore(job) {
    if (job.offset >= job.file.length) {
      this.stop();
      return;
    }
    const samples = job.file.slice(job.offset, job.offset + job.stride);
    job.offset += samples.length;
    this.#measure(job, samples);
    this.#post(job, { type: 'chunk', samples }, [samples.buffer]);
  }

  #receive({ id, type, ...payload }) {
    const job = this.#job;
    if (!job || (id !== undefined && id !== job.id)) {
      return;
    }
    switch (type) {
      case 'chunk':
        if (job.file && !job.stopping) {
          this.#sendMore(job);
        }
        break;
      case 'syllable':
        this.#emit({ lastSyllable: payload.end });
        break;
      case 'final':
        job.finals.push(payload);
        this.#emit({
          committedWords: this.status.committedWords + payload.words.length,
          result: mergeResults(job.finals, null),
        });
        break;
      case 'partial':
        this.#emit({ result: mergeResults(job.finals, payload) });
        break;
      case 'result':
        this.#complete(job, payload.result);
        break;
      case 'error':
        this.#fail(job, payload);
        break;
    }
  }

  #complete(job, result) {
    if (!result.words.length) {
      this.#fail(job, { code: 'empty' });
      return;
    }
    this.#job = null;
    this.#releaseMicrophone(job);
    this.#emit({
      state: 'done',
      inputLevel: null,
      result: {
        ...result,
        ...(job.finals.length && mergeResults(job.finals, null)),
      },
      committedWords: result.words.length,
    });
  }

  #fail(job, error) {
    if (job && this.#job === job) {
      this.#discard();
      this.#emit({
        state: 'error',
        inputLevel: null,
        error: {
          code: error.name === 'NotAllowedError' ? 'denied' : error.code,
          message: error.message,
        },
      });
    }
  }

  #releaseMicrophone(job) {
    const microphone = job.microphone;
    job.microphone = null;
    Promise.resolve(microphone?.stop()).catch((error) =>
      this.#fail(job, error)
    );
  }

  #discard() {
    const job = this.#job;
    this.#job = null;
    if (job) {
      this.#releaseMicrophone(job);
      if (job.started && this.#worker) {
        this.#post(job, { type: 'reset' });
      }
    }
  }

  #post(job, message, transfer) {
    this.#worker.postMessage({ ...message, id: job.id }, transfer ?? []);
  }

  #emit(patch) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }
}
