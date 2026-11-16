/**
 * The helper threads of the threads build of the Rust engine
 * (`src/engine/voice-simulator-threads.wasm`; see docs/RUST-ENGINE.md).
 *
 * `createThreadPool(module, memory, count)` starts `count - 1` workers from
 * `thread-worker.js`: `Worker` in browsers, Bun and Deno, and
 * `node:worker_threads` in Node.js, which has no global `Worker`. Each
 * worker instantiates the same `WebAssembly.Module` on the same shared
 * memory, sets up its own stack (64 KiB from `vs_alloc`) and thread-local
 * block with `vs_thread_init`, and then sleeps in `Atomics.wait` on a
 * control word. `pool.run(team)` stores the handle of a team of
 * `vs_team_new`, wakes the workers, and each calls
 * `vs_team_work(team, index)`, which returns when the leader ends the team
 * with `vs_team_free`. `pool.close()` ends the workers.
 *
 * No top-level `await` and no top-level import of `node:` modules, so the
 * file can be bundled for a browser.
 */

/** Bytes of the stack of every helper instance. */
export const THREAD_STACK_BYTES = 65536;

/** Alignment of a WebAssembly stack pointer. */
const STACK_ALIGN = 16;

/** Indices of the control words (an `Int32Array` over a `SharedArrayBuffer`). */
export const CONTROL = Object.freeze({
  /** Raised by 1 for every message to the workers; they wait on it. */
  GENERATION: 0,
  /** The team handle for the workers, or CLOSE. */
  TEAM: 1,
  /** Workers that have started (a worker adds 1 once ready). */
  READY: 2,
  /** Workers that failed to start. */
  FAILED: 3,
  /** Number of control words. */
  LENGTH: 4,
});

/** The TEAM value that ends the workers. */
export const CLOSE = -1;

/** Where the worker script lives next to this file. */
export function threadWorkerUrl() {
  return new globalThis.URL('./thread-worker.js', import.meta.url);
}

/**
 * `node:worker_threads`, reached without a module specifier a bundler can
 * see (as `nodeFs` of wasm-loader.js).
 * @returns {Promise<typeof import('node:worker_threads')>}
 */
async function nodeWorkerThreads() {
  const specifier = 'node:worker_threads';
  const getBuiltinModule = globalThis.process?.getBuiltinModule;
  if (typeof getBuiltinModule === 'function') {
    return getBuiltinModule(specifier);
  }
  return await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
}

/**
 * One worker running `thread-worker.js` with `data` as its first message,
 * in the API of the runtime. Resolves when it reports that it is ready,
 * rejects when it fails to start.
 * @returns {Promise<{terminate: () => unknown}>}
 */
async function startWorker(url, data) {
  if (typeof globalThis.Worker === 'function') {
    const worker = new globalThis.Worker(url, { type: 'module' });
    await new Promise((resolve, reject) => {
      worker.addEventListener('message', (event) => {
        if (event.data?.ready) {
          resolve();
        } else {
          reject(new Error(event.data?.error ?? 'thread worker failed'));
        }
      });
      worker.addEventListener('error', (event) =>
        reject(new Error(event.message ?? 'thread worker failed'))
      );
      worker.postMessage(data);
    });
    return worker;
  }
  const { Worker } = await nodeWorkerThreads();
  const worker = new Worker(url, { workerData: data });
  await new Promise((resolve, reject) => {
    worker.once('message', (message) => {
      if (message?.ready) {
        resolve();
      } else {
        reject(new Error(message?.error ?? 'thread worker failed'));
      }
    });
    worker.once('error', reject);
  });
  // The workers sleep in Atomics.wait between renders; they must not keep
  // a Node.js process alive on their own.
  worker.unref();
  return worker;
}

/**
 * A block of `bytes` bytes from `vs_alloc`, aligned to `align` inside a
 * block that is `align` bytes larger; `{pointer, block, bytes}` for
 * vs_free.
 */
function allocAligned(exports, bytes, align) {
  const size = bytes + align;
  const block = exports.vs_alloc(size);
  if (block === 0) {
    throw new Error('thread pool: the engine memory is exhausted');
  }
  const pointer = Math.ceil(block / align) * align;
  return { pointer, block, size };
}

/**
 * Start the helpers of the threads build.
 *
 * @param {WebAssembly.Module} module the compiled threads file
 * @param {WebAssembly.Memory} memory its shared memory
 * @param {number} count threads in total, the caller (the leader)
 *   included; `count - 1` workers start
 * @param {{exports: Record<string, Function>, url?: URL | string}} options
 *   `exports` of the leader's instance of `module`, whose `vs_alloc` gives
 *   the stacks and thread-local blocks of the helpers (a helper instance
 *   cannot call it before it has a stack); `url` of the worker script
 * @returns {Promise<{size: number, run: (team: number) => void,
 *   close: () => void}>} `size` is `count`; rejects (after ending every
 *   worker it started) when a worker cannot start
 */
export async function createThreadPool(module, memory, count, options) {
  const { exports } = options;
  const url = options.url ?? threadWorkerUrl();
  const helpers = Math.max(0, Math.floor(count) - 1);
  const control = new Int32Array(
    new globalThis.SharedArrayBuffer(4 * CONTROL.LENGTH)
  );
  const tlsSize = exports.vs_thread_tls_size();
  const tlsAlign = Math.max(STACK_ALIGN, exports.vs_thread_tls_align());
  const blocks = [];
  const workers = [];
  const close = () => {
    Atomics.store(control, CONTROL.TEAM, CLOSE);
    Atomics.add(control, CONTROL.GENERATION, 1);
    Atomics.notify(control, CONTROL.GENERATION);
    for (const worker of workers.splice(0)) {
      worker.terminate();
    }
    for (const { block, size } of blocks.splice(0)) {
      exports.vs_free(block, size);
    }
  };
  try {
    const starts = [];
    for (let index = 1; index <= helpers; index += 1) {
      const stack = allocAligned(exports, THREAD_STACK_BYTES, STACK_ALIGN);
      const tls = allocAligned(exports, Math.max(1, tlsSize), tlsAlign);
      blocks.push(stack, tls);
      const data = {
        module,
        memory,
        control,
        index,
        stackTop: stack.pointer + THREAD_STACK_BYTES,
        tls: tls.pointer,
      };
      starts.push(
        startWorker(url, data).then((worker) => {
          workers.push(worker);
        })
      );
    }
    const results = await Promise.allSettled(starts);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
  } catch (problem) {
    close();
    throw problem;
  }
  return {
    size: helpers + 1,
    /**
     * Wake every worker into `vs_team_work(team, index)`. Call it after
     * `vs_team_new` and before the render; `vs_team_free` after the render
     * waits until all of them have left it again.
     * @param {number} team a handle of vs_team_new (> 0)
     */
    run(team) {
      Atomics.store(control, CONTROL.TEAM, team);
      Atomics.add(control, CONTROL.GENERATION, 1);
      Atomics.notify(control, CONTROL.GENERATION);
    },
    /** End the workers and free their stacks. Not during a render. */
    close,
  };
}
