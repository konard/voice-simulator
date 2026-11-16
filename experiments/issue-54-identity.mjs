// Hashes of plain-text renders with the default head (issue 54): run in
// this tree and in a checkout of main; every line but the Hindi breathy
// stop must match.
// node experiments/issue-54-identity.mjs [engine]
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';
const engine = process.argv[2];
const CASES = [
  ['Please call Stella.', {}],
  ['You are coming.', {}],
  ['Hello world, how are you?', { tier: 'minimal' }],
  ['[ˈmasa ˈna]', { tier: 'minimal' }],
  ['paː pʰaː baː', { lang: 'hi', ipa: true }],
  ['bʱaː', { lang: 'hi', ipa: true }],
];
for (const [text, extra] of CASES) {
  const options = {
    tier: 'medium',
    seed: 1,
    ...extra,
    ...(engine ? { engine } : {}),
  };
  let line;
  try {
    const r = synthesize(text, options);
    const hash = createHash('sha256')
      .update(Buffer.from(r.samples.buffer))
      .digest('hex')
      .slice(0, 16);
    line = `${hash} ${r.samples.length}`;
  } catch (error) {
    line = `error ${error.message}`;
  }
  console.log(JSON.stringify([text, extra]), line);
}
