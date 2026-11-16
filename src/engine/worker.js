/**
 * The synthesis worker (`voice-simulator/worker`): start it with
 * `new Worker(new URL('voice-simulator/worker', import.meta.url), {type: 'module'})`.
 * Its messages are listed in ./worker-protocol.js.
 */

/* global self */
import { createWorkerHandler } from './worker-protocol.js';

const handle = createWorkerHandler((m, t) => self.postMessage(m, t));
self.onmessage = (event) => handle(event.data);
