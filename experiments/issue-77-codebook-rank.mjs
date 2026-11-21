/** Compare the warmed codebook search kernels on identical packed rows. Unlicense. */
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createRandom } from '../src/random.js';
import { buildCodebook } from '../src/recognition/codebook.js';
import { envelopeKey } from '../src/recognition/codebook-features.js';
import { searchCodebookJob } from '../src/recognition/codebook-jobs.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';

const engine = globalThis.process.argv[2] ?? 'rust';
const kernels = await createRecognitionEngine({ engine, threads: 1 });
const book = buildCodebook({}, { size: 256 });
const random = createRandom(1);
const rows = new Float64Array(400 * 30);
for (let frame = 0; frame < 400; frame++) {
  const start = frame * 30;
  const row = Math.floor(random() * book.size) * 24;
  const present = frame % 2 ? 20 : 24;
  for (let band = 0; band < 24; band++) {
    rows[start + band] =
      band < present ? 0.5 * book.envelope[row + band] - 64 + random() : NaN;
  }
  envelopeKey(
    rows.subarray(start, start + 24),
    rows.subarray(start + 24, start + 30)
  );
}
const job = { rows, k: 16 };
let output;
for (let run = 0; run < 5; run++) {
  output = searchCodebookJob(book, job, kernels);
}
const timings = [];
for (let run = 0; run < 15; run++) {
  const start = performance.now();
  output = searchCodebookJob(book, job, kernels);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
console.log({
  engine,
  milliseconds: timings[7],
  sha256: createHash('sha256')
    .update(new Uint8Array(output.buffer))
    .digest('hex'),
});
