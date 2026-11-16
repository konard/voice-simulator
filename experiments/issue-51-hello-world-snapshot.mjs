// Issue 51: rewrite the f0 snapshot of non-tonal speech under language zh
// (tests/fixtures/issue-49/hello-world-f0.json) with the tune model of
// issue 51. The test "leaves non-tonal speech alone" then keeps guarding
// that the tone model of issue 49 does not touch syllables without tones.
// Usage: node experiments/issue-51-hello-world-snapshot.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const url = new URL('../tests/fixtures/issue-49/hello-world-f0.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(url, 'utf8'));
const plan = planUtterance(snapshot.ipa, {
  head: normalizeHeadConfig(snapshot.head),
  language: snapshot.language,
});
const next = {
  ...snapshot,
  note:
    'f0 channel (Hz) of planUtterance with the tunes of issue 51 (a statement fall), ' +
    'CONTROL_RATE frames; the tone model of issue 49 must not change it',
  f0: [...plan.channels.f0],
};
if (process.argv.includes('--write')) {
  writeFileSync(url, `${JSON.stringify(next, null, 2)}\n`);
}
const st = (hz) => 12 * Math.log2(hz / 120);
console.log(
  `frames ${next.f0.length}; first ${next.f0[0].toFixed(2)} Hz, max ${Math.max(...next.f0).toFixed(2)} Hz, last ${next.f0.at(-1).toFixed(2)} Hz (${st(next.f0.at(-1)).toFixed(2)} st from 120 Hz)`
);
