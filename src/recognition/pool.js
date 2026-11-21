/** A fixed pool of recognition workers with private memory. Unlicense. */
export function recognitionThreadCount(threads = 'auto') {
  if (threads !== 'auto') {
    if (!Number.isSafeInteger(threads) || threads < 1) {
      throw new RangeError('threads must be a positive integer or auto');
    }
    return threads;
  }
  const cores =
    globalThis.process?.getBuiltinModule?.('node:os')?.availableParallelism() ??
    globalThis.navigator?.hardwareConcurrency ??
    1;
  return Math.max(1, Math.min(8, cores));
}

async function createRuntimeWorker() {
  if (typeof globalThis.Worker === 'function') {
    // The literal Worker URL lets browser bundlers package the module graph.
    // eslint-disable-next-line no-undef
    return new Worker(new URL('./pool-worker.js', import.meta.url), {
      type: 'module',
    });
  }
  const specifier = 'node:worker_threads';
  const { Worker: NodeWorker } =
    globalThis.process?.getBuiltinModule?.(specifier) ??
    (await import(/* @vite-ignore */ specifier));
  return new NodeWorker(
    new globalThis.URL('./pool-worker.js', import.meta.url)
  );
}

function client(worker) {
  let failure;
  let resolve;
  let reject;
  const installed = new WeakMap();
  let nextTable = 0;
  function broken(error) {
    failure = error;
    reject?.(error);
  }
  function received(data) {
    if (data.error) {
      broken(new Error(data.error));
    } else {
      resolve?.(data.result);
    }
  }
  if (worker.on) {
    worker.on('message', received);
    worker.on('messageerror', broken);
    worker.on('error', broken);
    worker.on('exit', (code) => broken(new Error(`Worker exited (${code})`)));
  } else {
    worker.addEventListener('message', ({ data }) => received(data));
    worker.addEventListener('messageerror', broken);
    worker.addEventListener('error', broken);
  }
  return {
    async run(type, job, table, engine) {
      if (failure) {
        throw failure;
      }
      let tableId = table && installed.get(table);
      let setup;
      if (table && !tableId) {
        tableId = ++nextTable;
        installed.set(table, tableId);
        setup = table;
      }
      const transfer = [];
      if (type === 'audio' && ArrayBuffer.isView(job.samples)) {
        // Cloning a subarray clones the entire recording's backing buffer.
        // A private copy of this piece also preserves the samples for retries.
        const samples =
          job.samples instanceof Float32Array
            ? new Float32Array(job.samples)
            : new Float64Array(job.samples);
        job = { ...job, samples };
        transfer.push(samples.buffer);
      }
      try {
        return await new Promise((res, rej) => {
          resolve = res;
          reject = rej;
          worker.postMessage({ type, job, tableId, setup, engine }, transfer);
        });
      } finally {
        resolve = undefined;
        reject = undefined;
      }
    },
    terminate() {
      return worker.terminate();
    },
  };
}

export function createRecognitionPool({
  threads = 'auto',
  engine = 'auto',
  createWorker = createRuntimeWorker,
} = {}) {
  const size = recognitionThreadCount(threads);
  const workers = [];
  let closed = false;
  let current = Promise.resolve();

  async function dispatch(type, jobs, local, table) {
    if (closed) {
      throw new Error('Recognition pool is closed');
    }
    if (size === 1 || jobs.length < 2) {
      const results = [];
      for (const job of jobs) {
        results.push(await local(job));
      }
      return results;
    }
    const results = new Array(jobs.length);
    const pending = jobs.map((_, index) => index);
    if (type === 'audio') {
      // Start long pieces first so the final job is less likely to keep
      // the other workers idle. Store results by original time order.
      pending.sort((a, b) => jobs[b].samples.length - jobs[a].samples.length);
    }
    let next = 0;
    async function task(slot) {
      let worker;
      try {
        workers[slot] ??= Promise.resolve().then(createWorker).then(client);
        worker = await workers[slot];
      } catch {
        // A runtime may prohibit worker creation. Each job is still runnable.
      }
      while (next < jobs.length) {
        const index = pending[next++];
        if (worker) {
          try {
            results[index] = await worker.run(type, jobs[index], table, engine);
            continue;
          } catch {
            // If the worker fails mid-job, rerun the original inputs locally.
          }
        }
        results[index] = await local(jobs[index]);
      }
    }
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(size, jobs.length) }, (_, slot) =>
        task(slot)
      )
    );
    const failure = settled.find(({ status }) => status === 'rejected');
    if (failure) {
      throw failure.reason;
    }
    return results;
  }

  return {
    size,
    run(type, jobs, local, table) {
      const work = current.then(() => dispatch(type, jobs, local, table));
      current = work.catch(() => {});
      return work;
    },
    async close() {
      await current;
      closed = true;
      await Promise.allSettled(
        workers.map(async (worker) => (await worker).terminate())
      );
    },
  };
}
