import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  addLexicon,
  clearLexicons,
  DEFAULT_HEAD,
  recognize,
  synthesize,
} from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { searchCodebookJob } from '../src/recognition/codebook-jobs.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';
import { createRecognitionPool } from '../src/recognition/pool.js';
import { scoreJob } from '../src/recognition/rescoring.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const rate = 8000;
const options = {
  level: 'low',
  languages: ['en'],
  voice: DEFAULT_HEAD,
  modes: false,
};

function speech() {
  const sound = synthesize('Hello.', {
    engine: 'js',
    tier: 'minimal',
    seed: 1,
  });
  return resample(sound.samples, sound.sampleRate, rate);
}

function recording() {
  const phrase = speech();
  const input = new Float32Array(12 * rate);
  for (const start of [0.2, 10.5]) {
    input.set(phrase.subarray(0, rate), Math.round(start * rate));
  }
  return input;
}

function threadsMatch(engine, expectedWord) {
  return async () => {
    const samples = recording();
    const settings = { ...options, engine, nbest: 2 };
    const expected = await recognize(samples, rate, {
      ...settings,
      threads: 1,
    });
    assert.ok(expected.words.length);
    if (expectedWord) {
      assert.equal(expected.words[0].text, expectedWord);
    }
    for (const threads of [2, 4]) {
      const other = await recognize(samples, rate, { ...settings, threads });
      assert.equal(JSON.stringify(other), JSON.stringify(expected));
    }
  };
}

it('JavaScript recognition keeps the same pronunciation overrides at every thread count', async () => {
  addLexicon('en', { the: 'ˈpɹoʊ' });
  try {
    await threadsMatch('js', 'the')();
  } finally {
    clearLexicons();
  }
});
itUnless(noRust)(
  'Rust recognition does not depend on the number of threads',
  threadsMatch('rust')
);

it('runs independent codebook and rescoring jobs in module workers', async () => {
  const pool = createRecognitionPool({ threads: 2, engine: 'js' });
  const table = {
    tree: Int32Array.of(0, 0, -1, -1),
    key: new Float32Array(6),
    envelope: new Uint8Array(24),
  };
  const queries = [0.1, 0.2, 0.3].map((value) => ({
    rows: new Float64Array(30).fill(value),
    k: 1,
  }));
  const rescoring = [1, 3, 2].map((value) => ({
    recording: { rows: [[1], [2]], first: 0, last: 2 },
    reference: [[value], [value]],
    bias: [0],
  }));
  const unexpectedFallback = () => {
    throw new Error('this job must run off the calling thread');
  };
  try {
    assert.deepEqual(
      await pool.run('codebook', queries, unexpectedFallback, table),
      queries.map((job) => searchCodebookJob(table, job))
    );
    assert.deepEqual(
      await pool.run('rescore', rescoring, unexpectedFallback),
      rescoring.map(scoreJob)
    );
  } finally {
    await pool.close();
  }
});

it('creates no worker with one thread', async () => {
  let spawned = 0;
  const pool = createRecognitionPool({
    threads: 1,
    createWorker() {
      spawned++;
      throw new Error('must not call createWorker');
    },
  });
  try {
    assert.deepEqual(await pool.run('codebook', [3, 2], (n) => n * 2), [6, 4]);
    assert.equal(spawned, 0);
  } finally {
    await pool.close();
  }
});

it('survives a failing worker and recomputes the job in input order', async () => {
  let sent = 0;
  let closed = 0;
  const pool = createRecognitionPool({
    threads: 2,
    createWorker: () => ({
      on() {},
      postMessage() {
        sent++;
        throw new Error('failed to send');
      },
      terminate() {
        closed++;
      },
    }),
  });
  try {
    assert.deepEqual(
      await pool.run('codebook', [3, 2, 1], (n) => n * 2),
      [6, 4, 2]
    );
    assert.ok(sent > 0);
  } finally {
    await pool.close();
  }
  assert.equal(closed, 2);
});

it('sends only the bytes belonging to each recording piece', async () => {
  const recording = Float32Array.of(0, 1, 2, 3, 4, 5);
  const jobs = [
    { samples: recording.subarray(0, 2) },
    { samples: recording.subarray(2, 5) },
  ];
  const pool = createRecognitionPool({
    threads: 2,
    createWorker() {
      let receive;
      return {
        on(type, callback) {
          if (type === 'message') {
            receive = callback;
          }
        },
        postMessage(message, transfer) {
          const { job } = globalThis.structuredClone(message, { transfer });
          receive({ result: [job.samples[0], job.samples.buffer.byteLength] });
        },
        terminate() {},
      };
    },
  });
  try {
    assert.deepEqual(await pool.run('audio', jobs, () => null), [
      [0, 8],
      [2, 12],
    ]);
    assert.deepEqual([...recording], [0, 1, 2, 3, 4, 5]);
  } finally {
    await pool.close();
  }
});

it('falls back to JavaScript if the shared loader rejects', async () => {
  const reject = () => Promise.reject(new Error('WebAssembly is unavailable'));
  const kernels = await createRecognitionEngine(
    { engine: 'auto', threads: 1 },
    reject
  );
  assert.equal(kernels.name, 'js');
  const samples = speech();
  const expected = recognize(samples, rate, {
    ...options,
    engine: 'js',
    threads: 1,
  });
  assert.deepEqual(
    recognize(samples, rate, { ...options, kernels, threads: 1 }),
    expected
  );
  await assert.rejects(createRecognitionEngine({ engine: 'rust' }, reject), {
    code: 'ENGINE_UNAVAILABLE',
  });
});
