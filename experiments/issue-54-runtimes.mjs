// Hashes of the phonation renders of issue 54, to compare the runtimes:
// node experiments/issue-54-runtimes.mjs; bun experiments/issue-54-runtimes.mjs;
// deno run -A experiments/issue-54-runtimes.mjs
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';
const TEXT = 'Please call Stella.';
const CASES = [[TEXT, { markup: true }]];
for (const name of [
  'breathy',
  'lax',
  'pressed',
  'creaky',
  'falsetto',
  'harsh',
]) {
  CASES.push([
    `<speak><vs:phonation name="${name}" degree="1">${TEXT}</vs:phonation></speak>`,
    { markup: true },
  ]);
}
CASES.push(['You are coming.', { head: { finalCreak: 1 } }]);
CASES.push(['paː pʰaː baː bʱaː', { ipa: true, lang: 'hi' }]);
for (const [text, extra] of CASES) {
  const r = synthesize(text, { tier: 'medium', seed: 1, ...extra });
  const hash = createHash('sha256')
    .update(
      new Uint8Array(
        r.samples.buffer,
        r.samples.byteOffset,
        r.samples.byteLength
      )
    )
    .digest('hex')
    .slice(0, 16);
  console.log(hash, text.slice(0, 50));
}
