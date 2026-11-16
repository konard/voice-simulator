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
// The least-squares line of the voiced frames (10 ms apart) in semitones,
// without octave errors (more than 6 st from the median), over the vowel.
const centre = 12 * Math.log2(median(track));
const points = track.flatMap((f0, index) => {
  const y = f0 > 0 ? 12 * Math.log2(f0) : NaN;
  return Math.abs(y - centre) <= 6 ? [{ x: index * 0.01, y }] : [];
});
const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
const slope =
  points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) /
  points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
const seconds = vowel.end - vowel.start;
console.log(
  'breathy',
  seconds.toFixed(2),
  's, f0',
  track.find((v) => v > 0).toFixed(0),
  '->',
  track.findLast((v) => v > 0).toFixed(0),
  'Hz, fitted fall',
  (-slope * seconds).toFixed(2),
  'st'
);
console.log(track.map((v) => v.toFixed(0)).join(' '));
