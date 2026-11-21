import { levelForTier } from '../../../../src/recognition/recognizer.js';
import { mergeResults } from '../components/recognition-timeline.js';

const initialStatus = () => ({
  state: 'idle',
  active: false,
  reason: null,
  load: 0,
  overloaded: false,
  voicedSeconds: 0,
  voice: null,
  uncertainty: null,
  changes: {},
  stability: 0,
  converged: false,
  result: mergeResults([], null),
  committedWords: 0,
  lastSyllable: null,
  canRepeat: false,
  error: null,
});

export function canSave(status, consent) {
  return Boolean(status.voice && consent);
}

export class CopySession {
  #job;
  #requests = new Map();
  #nextId = 1;

  constructor({ createWorker, onChange = () => {} }) {
    this.createWorker = createWorker;
    this.onChange = onChange;
    this.status = initialStatus();
  }

  async start(source, { languages, tier } = {}) {
    this.reset();
    let job;
    try {
      const worker = this.createWorker();
      job = { worker, finals: [], offset: 0, streak: 0, languages, tier };
      this.#job = job;
      worker.addEventListener('message', ({ data }) => {
        if (this.#job === job) {
          this.#receive(job, data);
        }
      });
      worker.addEventListener('error', (error) => this.#fail(job, error));
      this.#emit({ active: true, state: 'asking' });
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
              this.#capture(job, samples);
            }
          },
          onError: (error) => this.#fail(job, error),
        });
      } else {
        job.file = input.samples;
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

  #begin(job, sampleRate) {
    if (!job.started && sampleRate !== undefined) {
      job.started = true;
      job.stride = Math.max(1, Math.floor(sampleRate * 0.02));
      job.worker.postMessage({
        type: 'start',
        sampleRate,
        languages: job.languages,
        level: job.tier ? levelForTier(job.tier) : 'auto',
      });
    }
  }

  #capture(job, samples) {
    let from = 0;
    while (from < samples.length) {
      job.capture ??= new Float32Array(job.stride);
      const end = Math.min(samples.length, from + job.stride - job.offset);
      job.capture.set(samples.subarray(from, end), job.offset);
      job.offset += end - from;
      from = end;
      if (job.offset === job.stride) {
        this.#sendCapture(job);
      }
    }
  }

  #sendCapture(job) {
    if (job.capture) {
      const samples = job.capture.subarray(0, job.offset);
      job.capture = null;
      job.offset = 0;
      job.worker.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    }
  }

  #sendMore(job) {
    if (job.offset >= job.file.length) {
      this.stop();
      return;
    }
    const samples = job.file.slice(job.offset, job.offset + job.stride);
    job.offset += samples.length;
    job.worker.postMessage({ type: 'chunk', samples, acknowledge: true }, [
      samples.buffer,
    ]);
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
    this.#sendCapture(job);
    job.file = null;
    job.worker.postMessage({ type: 'stop' });
  }

  reset() {
    this.dispose();
    this.#emit(initialStatus());
  }

  dispose() {
    const job = this.#job;
    this.#job = null;
    if (job) {
      this.#releaseMicrophone(job);
      job.worker.terminate();
    }
    for (const { reject } of this.#requests.values()) {
      reject(
        Object.assign(new Error('Voice session ended'), { name: 'AbortError' })
      );
    }
    this.#requests.clear();
  }

  #releaseMicrophone(job) {
    const microphone = job.microphone;
    job.microphone = null;
    Promise.resolve(microphone?.stop()).catch((error) =>
      this.#fail(job, error)
    );
  }

  #fail(job, error) {
    if (this.#job === job || (!job && !this.#job)) {
      this.dispose();
      this.#emit({
        ...initialStatus(),
        state: 'error',
        error: {
          code: error.name === 'NotAllowedError' ? 'denied' : error.code,
          message: error.message,
        },
      });
    }
  }

  speak(text, lang, tier) {
    return this.#render({ type: 'speak', text, lang, tier });
  }

  repeat(tier) {
    return this.#render({ type: 'repeat', tier });
  }

  #render(message) {
    const { worker } = this.#job ?? {};
    if (!worker || !this.status.voice) {
      return Promise.reject(new Error('No fitted voice'));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#requests.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        this.#requests.delete(id);
        reject(error);
      }
    });
  }

  #receive(job, { id, type, ...payload }) {
    switch (type) {
      case 'chunk':
        if (job.file && !job.stopping) {
          this.#sendMore(job);
        }
        break;
      case 'stopped':
        this.#emit({ active: false, overloaded: false });
        break;
      case 'state':
        this.#state(payload);
        break;
      case 'progress':
        this.#emit({ voicedSeconds: payload.voicedSeconds });
        break;
      case 'load':
        this.#load(job, payload.load);
        break;
      case 'voice': {
        const { voice, uncertainty, changes, converged } = payload;
        const stability =
          1 - Math.min(1, Math.max(0, ...Object.values(changes)) / 0.1);
        this.#emit({ voice, uncertainty, changes, stability, converged });
        break;
      }
      case 'syllable':
        this.#emit({ lastSyllable: payload.end });
        break;
      case 'final':
        job.finals.push(payload);
        this.#emit({
          committedWords: this.status.committedWords + payload.words.length,
          canRepeat: this.status.canRepeat || Boolean(payload.words.length),
          result: mergeResults(job.finals, null),
        });
        break;
      case 'partial':
        this.#emit({ result: mergeResults(job.finals, payload) });
        break;
      case 'audio':
      case 'error':
        this.#complete(job, id, type, payload);
        break;
    }
  }

  #state({ state, reason, voicedSeconds }) {
    const patch = { state, reason, voicedSeconds };
    if (reason === 'speaker-change') {
      Object.assign(patch, {
        voice: null,
        uncertainty: null,
        changes: {},
        stability: 0,
        converged: false,
        canRepeat: false,
      });
    } else if (reason === 'drift') {
      patch.converged = false;
    }
    this.#emit(patch);
  }

  #load(job, load) {
    const wasOverloaded = this.status.overloaded;
    const crossed = wasOverloaded ? load < 0.5 : load > 0.8;
    job.streak = crossed ? job.streak + 1 : 0;
    const overloaded = job.streak === 2 ? !wasOverloaded : wasOverloaded;
    if (overloaded !== wasOverloaded) {
      job.streak = 0;
      job.worker.postMessage({ type: 'share', value: overloaded ? 0 : 0.25 });
    }
    this.#emit({ load, overloaded });
  }

  #complete(job, id, type, payload) {
    const request = this.#requests.get(id);
    this.#requests.delete(id);
    if (type === 'audio') {
      request?.resolve(payload);
    } else if (request) {
      request.reject(new Error(payload.message));
    } else if (id === undefined) {
      this.#fail(job, payload);
    }
  }

  #emit(patch) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }
}
