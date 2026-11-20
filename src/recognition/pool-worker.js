/** The independent jobs of the private-memory recognition worker. Unlicense. */
import { searchCodebookJob } from './codebook-jobs.js';
import { createRecognitionEngine } from './engine.js';
import { recognize } from './recognizer.js';
import { scoreJob } from './rescoring.js';

const tables = new Map();
let loaded;

async function dispatch({ type, job, engine, tableId, setup }, send) {
  try {
    loaded ??= createRecognitionEngine({ engine, threads: 1 });
    const kernels = await loaded;
    if (setup) {
      tables.set(tableId, setup);
    }
    switch (type) {
      case 'codebook': {
        const result = searchCodebookJob(tables.get(tableId), job, kernels);
        send({ result }, [result.buffer]);
        break;
      }
      case 'rescore':
        send({ result: scoreJob(job) });
        break;
      case 'audio': {
        const { samples, sampleRate, options } = job;
        send({
          result: recognize(samples, sampleRate, {
            ...options,
            kernels,
            threads: 1,
          }),
        });
        break;
      }
      default:
        throw new Error(`Unknown recognition job: ${type}`);
    }
  } catch (error) {
    send({ error: error.message });
  }
}

if (typeof globalThis.postMessage === 'function') {
  globalThis.addEventListener('message', ({ data }) =>
    dispatch(data, (message, transfer) =>
      globalThis.postMessage(message, transfer)
    )
  );
} else {
  const specifier = 'node:worker_threads';
  const { parentPort } = globalThis.process.getBuiltinModule(specifier);
  parentPort.on('message', (data) =>
    dispatch(data, (message, transfer) =>
      parentPort.postMessage(message, transfer)
    )
  );
}
