/** Measure bounded codebook lookup across stored envelopes. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  buildCodebook,
  serializeCodebook,
  parseCodebook,
} from '../src/index.js';
const size = Number(process.argv[2] ?? 2000);
const path = `reports/issue-64-${size}.bin`;
mkdirSync('reports', { recursive: true });
const book = existsSync(path)
  ? parseCodebook(readFileSync(path))
  : buildCodebook({}, { size, cache: new Map() });
if (!existsSync(path)) {
  writeFileSync(path, serializeCodebook(book));
}
const out = { index: new Int32Array(16), cost: new Float64Array(16) };
const env = new Float64Array(24);
for (let round = 0; round < 3; round++) {
  const start = globalThis.performance.now();
  for (let i = 0; i < 10000; i++) {
    for (let j = 0; j < 24; j++) {
      env[j] = book.envelope[(i % book.size) * 24 + j] * 0.5 - 64;
    }
    book.query(env, 16, out);
  }
  console.log(
    `codebook query ${(globalThis.performance.now() - start) / 10} microseconds`
  );
}
