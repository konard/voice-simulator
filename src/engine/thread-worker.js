/**
 * A helper thread of the threads build of the Rust engine,
 * started by `createThreadPool` of `thread-pool.js`: a module `Worker` in
 * browsers, Bun and Deno, a `node:worker_threads` worker in Node.js.
 *
 * Its start data is `{module, memory, control, index, stackTop, tls}`: the
 * compiled threads file, its shared memory, the control words of the pool,
 * the helper index (1 to threads - 1) and the stack and thread-local block
 * the pool allocated for it. The worker instantiates the module on the
 * memory, calls `vs_thread_init(stackTop, tls)` before anything else,
 * reports `{ready: true}` and then sleeps in `Atomics.wait` on the
 * generation word. Woken, it reads the team handle and calls
 * `vs_team_work(team, index)`, which returns when the leader ends the
 * team; the TEAM value -1 ends the worker.
 */

/** Indices of the control words, as CONTROL of thread-pool.js. */
const GENERATION = 0;
const TEAM = 1;
const CLOSE = -1;

/** Run the helper of the start `data`; `post` reports to the pool. */
async function serve(data, post) {
  const { module, memory, control, index, stackTop, tls } = data;
  let exports;
  try {
    const instance = await globalThis.WebAssembly.instantiate(module, {
      env: { memory },
    });
    exports = instance.exports;
    exports.vs_thread_init(stackTop, tls);
  } catch (problem) {
    post({ error: String(problem?.message ?? problem) });
    return;
  }
  // The generation before the first run: the pool raises it only after
  // every worker is ready.
  let seen = Atomics.load(control, GENERATION);
  post({ ready: true });
  for (;;) {
    Atomics.wait(control, GENERATION, seen);
    seen = Atomics.load(control, GENERATION);
    const team = Atomics.load(control, TEAM);
    if (team === CLOSE) {
      return;
    }
    exports.vs_team_work(team, index);
  }
}

/** `node:worker_threads` in Node.js, else null. */
function nodeWorkerThreads() {
  const getBuiltinModule = globalThis.process?.getBuiltinModule;
  return typeof getBuiltinModule === 'function'
    ? getBuiltinModule('node:worker_threads')
    : null;
}

// A Node.js worker gets its data as `workerData`; a Web Worker (also in
// Bun and Deno, which have `node:worker_threads` too) as its first message.
const node = nodeWorkerThreads();
if (node?.parentPort && node.workerData) {
  const { parentPort, workerData } = node;
  serve(workerData, (message) => parentPort.postMessage(message));
} else {
  globalThis.addEventListener(
    'message',
    (event) => {
      serve(event.data, (message) => globalThis.postMessage(message));
    },
    { once: true }
  );
}
