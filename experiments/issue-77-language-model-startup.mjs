/** Measure issue 77's pronunciation-model startup costs. Unlicense. */
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { getLanguageModel } from '../src/recognition/language-model.js';

for (const language of ['en', 'ru', 'hi', 'zh']) {
  const started = performance.now();
  const { singles, pairs, triples, total } = getLanguageModel(language);
  const buildMs = performance.now() - started;
  const encoded = gzipSync(
    Buffer.from(JSON.stringify([[...singles], [...pairs], [...triples], total]))
  );
  const reading = performance.now();
  const [one, two, three, count] = JSON.parse(gunzipSync(encoded).toString());
  const decoded = {
    singles: new Map(one),
    pairs: new Map(two),
    triples: new Map(three),
    total: count,
  };
  const readMs = performance.now() - reading;
  assert.deepEqual(decoded, { singles, pairs, triples, total });
  console.log(
    `${language} builds in ${buildMs.toFixed(1)} ms, reads in ${readMs.toFixed(1)} ms and uses ${encoded.length} compressed bytes`
  );
}
