/** Compare every shipped Gaussian state with an earlier scorer. Unlicense. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as current from '../src/recognition/hmm-model.js';

const [revision = '4f30e78e'] = process.argv.slice(2);
const sourceDirectory = new URL('../src/recognition/', import.meta.url);
const source = execFileSync(
  'git',
  ['show', `${revision}:src/recognition/hmm-model.js`],
  { cwd: fileURLToPath(sourceDirectory), encoding: 'utf8' }
).replace(/(['"])(\.{1,2}\/[^'"]+)\1/gu, (_, quote, path) =>
  JSON.stringify(new URL(path, sourceDirectory).href)
);
const baseline = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const model = current.getHmmModel();
const reference = baseline.getHmmModel();
const frames = Float32Array.from(
  { length: model.dims * 8 },
  (_, i) => (i % 7) * Math.sin(i)
);

for (let offset = 0; offset < frames.length; offset += model.dims) {
  for (let m = 0; m < model.states; m++) {
    assert.equal(
      current.stateScore(m, frames, offset, model),
      baseline.stateScore(m, frames, offset, reference)
    );
  }
}

function measure(scorer) {
  const { stateScore, getHmmModel } = scorer;
  const acoustic = getHmmModel();
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const offset = (i % 8) * acoustic.dims;
    for (let m = 0; m < acoustic.states; m++) {
      sum += stateScore(m, frames, offset, acoustic);
    }
  }
  return { sum, milliseconds: performance.now() - start };
}

const before = measure(baseline);
const after = measure(current);
assert.equal(after.sum, before.sum);
console.log(`${model.states} states × 8 frames matched exactly`);
console.table({ before, after });
