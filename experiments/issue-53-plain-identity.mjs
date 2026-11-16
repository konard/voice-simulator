// Plain text (no markup) must give the same samples before and after the
// whisper (issue 53), with each engine. Usage:
//   git worktree add /tmp/vs-base origin/main
//   (cd /tmp/vs-base && npm run build:wasm)   # main's interface version
//   node experiments/issue-53-plain-identity.mjs /tmp/vs-base
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2];
if (!base) {
  throw new Error('usage: issue-53-plain-identity.mjs <checkout of main>');
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
  ['[soft]Hello[/soft] [loud]world[/loud].', { tier: 'medium', markup: true }],
  ['ˈapa ˈaza ˈhi', { tier: 'medium', ipa: true }],
  ['Привет, мир.', { tier: 'low', lang: 'ru' }],
  ['你好。', { tier: 'low', lang: 'zh' }],
  ['नमस्ते।', { tier: 'low', lang: 'hi' }],
];
let same = true;
for (const engine of ['js', 'rust']) {
  for (const [text, caseOptions] of cases) {
    const options = { ...caseOptions, engine };
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
}
console.log(same ? 'identical' : 'DIFFERENT');
process.exitCode = same ? 0 : 1;
