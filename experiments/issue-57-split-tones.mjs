/**
 * Issue 57: splitTones() stays linear on long runs of tone letters
 * (CodeQL "polynomial regular expression" on src/accent/apply.js).
 * Run: node experiments/issue-57-split-tones.mjs
 */

import { splitTones } from '../src/accent/apply.js';

for (const size of [1e4, 1e5]) {
  const unit = `${'˥'.repeat(size)}x`;
  const start = globalThis.performance.now();
  splitTones(unit);
  const old = /[˥˦˧˨˩]+$/u;
  const middle = globalThis.performance.now();
  old.exec(unit);
  const end = globalThis.performance.now();
  console.log(
    `${size} tone letters: splitTones ${(middle - start).toFixed(1)} ms, regex ${(end - middle).toFixed(1)} ms`
  );
}
console.log(splitTones('a˨˩˦'), splitTones('t͡ɕ'), splitTones('˥'));
