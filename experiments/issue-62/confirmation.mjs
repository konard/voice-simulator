/** Finite counterexample: early, irrevocable confirmation conflicts with
 * replacing a lower peak when a higher one arrives within 80 ms. */
import assert from 'node:assert/strict';
import { createNucleusScanner } from '../../src/recognition/landmark-nuclei.js';

const hop = 0.005;
const count = 80;
const prefixCount = 29;
const points = [
  [0, -20],
  [20, 0],
  [24, -6],
  [28, -6],
  [32, 2],
  [40, -20],
  [79, -20],
];
const high = new Float32Array(count);
for (const [[left, low], [right, peak]] of points
  .slice(0, -1)
  .map((point, i) => [point, points[i + 1]])) {
  for (let t = left; t <= right; t++) {
    high[t] = low + ((peak - low) * (t - left)) / (right - left);
  }
}
const low = high.slice();
low.fill(-6, prefixCount);
assert.deepEqual(low.slice(0, prefixCount), high.slice(0, prefixCount));

function scan(sonority) {
  const frames = {
    hop,
    count: prefixCount,
    noise: new Float32Array(count).fill(-80),
    speech: new Uint8Array(count).fill(1),
    periodicity: new Float32Array(count).fill(0.9),
  };
  const output = { startTime: 0, sonority, nuclei: [] };
  const advance = createNucleusScanner(frames, output, {
    nucleusAboveNoise: 10,
    nucleusDip: 2,
  });
  const early = [];
  advance(21, early, false);
  assert.equal(early.length, 1);
  assert.equal(early[0].time, 20 * hop);
  frames.count = count;
  advance(count, [], true);
  return output.nuclei.map((nucleus) => nucleus.time);
}

const a = scan(low);
const b = scan(high);
assert(high[32] > high[20]);
assert((32 - 20) * hop < 0.08);
console.log(
  JSON.stringify({
    identicalThrough: (prefixCount - 1) * hop,
    confirmedFirst: 20 * hop,
    higherPeak: 32 * hop,
    peakSeparation: (32 - 20) * hop,
    currentWithoutHigherPeak: a,
    currentWithHigherPeak: b,
    requiredWithoutHigherPeak: [20 * hop],
    requiredWithHigherPeak: [32 * hop],
  })
);
console.log(
  'Both inputs require the first peak to be confirmed after the dip and its 40 ms maximum window. Only the second later requires that already-confirmed peak to be replaced.'
);
