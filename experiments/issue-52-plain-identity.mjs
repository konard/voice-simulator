// Plain text (no markup) must give the same samples before and after the
// vocal effort change (issue 52). Usage:
//   git worktree add /tmp/vs-base origin/main
//   node experiments/issue-52-plain-identity.mjs /tmp/vs-base
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2];
if (!base) {
  throw new Error('usage: issue-52-plain-identity.mjs <checkout of main>');
}
const here = await import('../src/index.js');
const before = await import(
  pathToFileURL(path.resolve(base, 'src/index.js')).href
);
const cases = [
  ['Please call Stella.', { tier: 'medium' }],
  ['Is it ready? Yes, it is!', { tier: 'low' }],
  ['Please call Stella.', { tier: 'medium', source: 'folds' }],
  ['Hello world.', { tier: 'medium', markup: true }],
];
let same = true;
for (const [text, options] of cases) {
  const a = before.synthesize(text, { seed: 1, ...options }).samples;
  const b = here.synthesize(text, { seed: 1, ...options }).samples;
  let differ = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      differ++;
    }
  }
  same &&= differ === 0;
  console.log(
    JSON.stringify(text),
    JSON.stringify(options),
    a.length,
    b.length,
    'different samples:',
    differ
  );
}
console.log(same ? 'identical' : 'DIFFERENT');
process.exitCode = same ? 0 : 1;
