/** Two silence runs with an identical first 60 ms require different final
 * classes under issue 62: a short bounded run is closure, a long run silence.
 * No causal implementation can distinguish these prefixes by that deadline. */
import assert from 'node:assert/strict';
import { cleanClasses } from '../../src/recognition/landmark-signals.js';
const hop = 0.005;
const short = Uint8Array.from([
  ...Array(40).fill(1),
  ...Array(20).fill(0),
  ...Array(40).fill(1),
]);
const long = Uint8Array.from([
  ...Array(40).fill(1),
  ...Array(40).fill(0),
  ...Array(40).fill(1),
]);
const frame = 44;
const deadline = frame + Math.round(0.06 / hop);
assert.deepEqual(short.slice(0, deadline + 1), long.slice(0, deadline + 1));
const a = cleanClasses(short, short.length, hop);
const b = cleanClasses(long, long.length, hop);
assert.equal(a[frame], 6);
assert.equal(b[frame], 0);
console.log(
  `Frame ${frame} must be closure (${a[frame]}) or silence (${b[frame]}), but all input through its 60 ms deadline is identical.`
);
