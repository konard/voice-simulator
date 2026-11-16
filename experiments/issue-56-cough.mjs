// Issue 56: the bursts of a cough: 1 ms level curve, the rise of each
// burst within 20 ms of its onset, and the voiced share.
// node experiments/issue-56-cough.mjs
import { levelDb, synthesize, voicedShare } from '../src/index.js';

const result = synthesize('[cough]', { tier: 'medium', seed: 1, markup: true });
const { samples, sampleRate, plan } = result;
const sound = plan.sounds[0];
const part = samples.subarray(
  Math.round(sound.start * sampleRate),
  Math.round(sound.end * sampleRate)
);
console.log('voiced', voicedShare(part, sampleRate).toFixed(3));
const hop = Math.round(0.001 * sampleRate);
const curve = [];
for (let i = 0; i + hop <= samples.length; i += hop) {
  curve.push(levelDb(samples, i, i + hop));
}
const bursts = plan.segments.filter((s) => s.soundOf && s.noise);
for (const burst of bursts) {
  const at = Math.round(burst.start * 1000);
  const before = Math.min(...curve.slice(at - 10, at + 1));
  const after = Math.max(...curve.slice(at, at + 20));
  console.log(
    'burst at',
    burst.start.toFixed(3),
    'from',
    before.toFixed(1),
    'to',
    after.toFixed(1),
    'rise',
    (after - before).toFixed(1)
  );
}
console.log(curve.map((v) => v.toFixed(0)).join(' '));
