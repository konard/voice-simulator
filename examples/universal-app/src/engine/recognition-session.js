import { mergeResults } from '../components/recognition-timeline.js';

const initialStatus = () => ({
  state: 'idle',
  result: mergeResults([], null),
  committedWords: 0,
  lastSyllable: null,
  error: null,
});

export class RecognitionSession {
  #worker = null;
  #job = null;
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

  async start(source, options = {}) {
    this.reset();
    const job = { id: this.#nextId++, finals: [], offset: 0, options };
    this.#job = job;
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
              this.#post(job, { type: 'chunk', samples }, [samples.buffer]);
            }
          },
          onError: (error) => this.#fail(job, error),
        });
      } else {
        job.file = input.samples;
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

  reset() {
    this.#discard();
    this.#emit(initialStatus());
  }

  dispose() {
    this.#discard();
    this.#worker?.terminate();
    this.#worker = null;
  }

  #begin(job, sampleRate) {
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
