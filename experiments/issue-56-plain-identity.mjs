// Plain text without sound words (and without `breaths`) must give the
// same samples before and after the paralinguistic sounds (issue 56).
// Texts with written fillers or laughter (um, uh, er, э, hahaha, 嗯) change
// by design. Usage:
//   git worktree add /tmp/vs-base origin/main
//   node experiments/issue-56-plain-identity.mjs /tmp/vs-base
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = process.argv[2];
if (!base) {
  throw new Error('usage: issue-56-plain-identity.mjs <checkout of main>');
}
const here = await import('../src/index.js');
const before = await import(
  pathToFileURL(path.resolve(base, 'src/index.js')).href
);
const cases = [
  ['Please call Stella.', { tier: 'medium' }],
  ['Is it ready? Yes, it is! Ha.', { tier: 'low' }],
  ['One. Two three four five six seven.', { tier: 'medium' }],
  ['Please call Stella.', { tier: 'medium', source: 'folds' }],
  ['Hello world.', { tier: 'medium', markup: true }],
  ['[soft]Hello[/soft] [loud]world[/loud].', { tier: 'medium', markup: true }],
  ['[whisper]Hello[/whisper] world.', { tier: 'medium', markup: true }],
  ['[sad]The train leaves at seven.[/sad]', { tier: 'medium', markup: true }],
  ['ˈma̤ma ˈma̰ma', { tier: 'medium', ipa: true }],
  ['ˈapa ˈaza ˈhi', { tier: 'medium', ipa: true }],
  ['Привет, мир. Это хорошо.', { tier: 'low', lang: 'ru' }],
  ['你好。我想喝水。', { tier: 'low', lang: 'zh' }],
  ['नमस्ते। ठीक है।', { tier: 'low', lang: 'hi' }],
];
let same = true;
for (const [text, caseOptions] of cases) {
  const options = { ...caseOptions, engine: 'js', seed: 1 };
  const ipaBefore = before.textToIpa(text, options).ipa;
  const ipaHere = here.textToIpa(text, options).ipa;
  const a = before.synthesize(text, options).samples;
  const b = here.synthesize(text, options).samples;
  let differ = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      differ++;
    }
  }
  same &&= differ === 0 && ipaBefore === ipaHere;
  console.log(
    JSON.stringify(text),
    JSON.stringify(caseOptions),
    ipaBefore === ipaHere ? 'same IPA' : `IPA ${ipaBefore} -> ${ipaHere}`,
    a.length,
    b.length,
    'different samples:',
    differ
  );
}
console.log(same ? 'identical' : 'DIFFERENT');
