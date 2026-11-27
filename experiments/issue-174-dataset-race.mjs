/** Reproduce competing writers to a cold certification cache. Unlicense. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFile } from '../scripts/datasets.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lowest-dataset-'));
const target = join(directory, 'speech.wav');
const url = 'https://example.test/speech.wav';
const bytes = new Uint8Array([1, 2, 3, 4]);
const expected = createHash('sha256').update(bytes).digest('hex');
let requests = 0;
let start;
const ready = new Promise((resolve) => (start = resolve));
const fetcher = async () => {
  if (++requests === 2) {
    start();
  }
  await ready;
  return new globalThis.Response(bytes);
};
try {
  const get = () => downloadFile(url, target, { sha256: expected, fetcher });
  const results = await Promise.allSettled([get(), get()]);
  console.log(
    results.map(({ status, reason }) => ({ status, error: reason?.message }))
  );
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  await get();
  const warmed = await Promise.all([get(), get()]);
  assert.deepEqual(
    warmed.map(({ status }) => status),
    ['cached', 'cached']
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
