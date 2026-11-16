// Text without markup gives the same IPA, words and samples as another
// checkout (main): textToIpa() and synthesize() of plain texts, including
// texts with brackets, stars and `<` that are not markup.
// Run:
//   git worktree add /tmp/voice-simulator-main origin/main
//   node experiments/issue-50-plain-identity.mjs /tmp/voice-simulator-main
//   git worktree remove /tmp/voice-simulator-main
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as here from '../src/index.js';

const other = process.argv[2];
if (!other) {
  console.error('usage: node issue-50-plain-identity.mjs <other checkout>');
  process.exit(2);
}
const there = await import(
  pathToFileURL(path.resolve(other, 'src/index.js')).href
);

const TEXTS = [
  'Hello world.',
  'Hello [world] and *stars* and a < b > c.',
  'Literal [1] and *.',
  'Привет, мир! Как дела?',
  'नमस्ते दुनिया।',
  '你好世界。',
  'On 3/4/2024 at 10:30 it cost $5.',
  'I read the record (twice), then read it again.',
  'speak <speak> without being SSML',
];

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
let failures = 0;
for (const text of TEXTS) {
  const a = here.textToIpa(text);
  const b = there.textToIpa(text);
  const ipaSame = a.ipa === b.ipa && same(a.words, b.words);
  const sa = here.synthesize(text, { seed: 7 });
  const sb = there.synthesize(text, { seed: 7 });
  const samplesSame =
    sa.samples.length === sb.samples.length &&
    sa.samples.every((value, index) => value === sb.samples[index]);
  if (!ipaSame || !samplesSame) {
    failures++;
  }
  console.log(
    `${ipaSame ? 'same' : 'DIFF'} ipa, ${samplesSame ? 'same' : 'DIFF'} ` +
      `${sa.samples.length} samples: ${text} -> ${a.ipa}`
  );
}
console.log(failures ? `${failures} texts differ` : 'all texts identical');
process.exitCode = failures ? 1 : 0;
