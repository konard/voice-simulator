// Issue 29: the start-up benchmark of the worker, in Node.js, to compare
// the load it measures with the one the app shows in the browser.
// Run: node experiments/issue-29-benchmark-node.mjs
import { createWorkerHandler } from '../src/engine/worker-protocol.js';
import { DEFAULT_HEAD } from '../src/index.js';

const replies = [];
const handle = createWorkerHandler((message) => replies.push(message));
await handle({ type: 'engine', engine: 'auto' });
const started = globalThis.performance.now();
await handle({ type: 'benchmark', head: DEFAULT_HEAD, gpu: false });
const ms = globalThis.performance.now() - started;
console.log(JSON.stringify({ ms: Math.round(ms), ...replies.at(-1) }));
