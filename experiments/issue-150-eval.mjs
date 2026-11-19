// Golden-set render-back MCD with cached voices (issue 150).
// Usage: node experiments/issue-150-eval.mjs [variant] [ids...]
// A variant module in experiments/issue-150-variants.mjs maps
// (item, head, book) -> rendered samples.
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
import { melCepstralDistortion } from '../src/index.js';
import * as variants from './issue-150-variants.mjs';

const [name = 'baseline', ...ids] = process.argv.slice(2);
const variant = variants[name];
if (!variant) {
  throw new Error(`unknown variant ${name}`);
}
const chosen = ids.length ? items.filter((x) => ids.includes(x.id)) : items;
let sum = 0;
const t0 = Date.now();
for (const item of chosen) {
  const head = voiceFor(item);
  const book = codebookFor(item, head);
  const t = Date.now();
  const rendered = variant(item, head, book);
  const mcd = melCepstralDistortion(item.samples, rendered, item.sampleRate);
  sum += mcd;
  console.log(
    item.id,
    mcd.toFixed(3),
    `${((Date.now() - t) / 1000).toFixed(1)}s`
  );
}
console.log(
  name,
  'mean',
  (sum / chosen.length).toFixed(3),
  'n',
  chosen.length,
  `${((Date.now() - t0) / 1000).toFixed(0)}s`
);
