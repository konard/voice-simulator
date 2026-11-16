// Issue 55: text without an emotion gives the samples of the main branch.
// Prints a hash of the samples of plain inputs for the source tree given as
// the first argument (default: this checkout), so the output of main and of
// the branch can be compared:
//   node experiments/issue-55-plain-identity.mjs /path/to/main/checkout
//   node experiments/issue-55-plain-identity.mjs .
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const { synthesize } = await import(
  pathToFileURL(path.join(root, 'src/index.js')).href
);
const CASES = [
  ['The train leaves at seven.', { tier: 'medium' }],
  [
    'The train leaves at seven.',
    { tier: 'medium', markup: true, headroom: 20 },
  ],
  ['I will see you on Monday?', { tier: 'low' }],
  ['Поезд отправляется в семь.', { lang: 'ru', tier: 'medium' }],
  ['火车七点出发。', { lang: 'zh', tier: 'low' }],
  [
    '[loud]Hello[/loud] there, [whisper]friend[/whisper].',
    { tier: 'low', markup: true },
  ],
  ['[breathy]Slowly now[/breathy].', { tier: 'medium', markup: true }],
];
for (const [text, options] of CASES) {
  const { samples } = synthesize(text, { seed: 1, ...options });
  const hash = createHash('sha256')
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest('hex')
    .slice(0, 16);
  console.log(
    hash,
    samples.length,
    JSON.stringify(text),
    JSON.stringify(options)
  );
}
