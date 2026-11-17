/** Bounded reproduction of allocation-heavy reverse-trie lookup comparisons. */
import { performance } from 'node:perf_hooks';
import { compareCodePoints } from '../../src/g2p/vslex.js';
import { RU_FORMS } from '../../src/g2p/lexicon/ru.js';

function allocatingComparison(left, right) {
  const a = [...left];
  const b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return a[i].codePointAt(0) - b[i].codePointAt(0);
    }
  }
  return a.length - b.length;
}

for (const [name, compare] of [
  ['allocating reference', allocatingComparison],
  ['in-place code points', compareCodePoints],
]) {
  const start = performance.now();
  let checksum = 0;
  for (let i = 0; i < 200000; i++) {
    const a = RU_FORMS.first[i % RU_FORMS.first.length];
    const b = RU_FORMS.first[(i * 17) % RU_FORMS.first.length];
    checksum += Math.sign(compare(a, b));
  }
  console.log(name, { ms: performance.now() - start, checksum });
}
