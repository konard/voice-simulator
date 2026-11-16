// Issue 56: the breathy part of a sigh and its pitch fall.
// node experiments/issue-56-sigh.mjs [text]
import { pitchTrack, synthesize } from '../src/index.js';

const text = process.argv[2] ?? '[sigh]';
const result = synthesize(text, { tier: 'medium', seed: 1, markup: true });
const { samples, sampleRate, plan } = result;
const vowel = plan.segments.find(
  (segment) => segment.soundOf && segment.soundPitch && !segment.noise
);
const slice = samples.subarray(
  Math.round(vowel.start * sampleRate),
  Math.round(vowel.end * sampleRate)
);
const track = Array.from(pitchTrack(slice, sampleRate));
const median = (values) => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const first = median(track.slice(0, 15));
const last = median(track.slice(-15));
console.log(
  'breathy',
  (vowel.end - vowel.start).toFixed(2),
  's, f0',
  first.toFixed(0),
  '->',
  last.toFixed(0),
  'Hz, fall',
  (12 * Math.log2(first / last)).toFixed(2),
  'st'
);
console.log(track.map((v) => v.toFixed(0)).join(' '));
