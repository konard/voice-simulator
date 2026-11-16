// Issue 56: voicing and median f0 of the throat clearing for a creak and
// a planned pitch (semitones re head.pitch), set by editing SOUNDS.throat.
// node experiments/issue-56-throat.mjs
import { pitchTrack, synthesize, voicedShare } from '../src/index.js';

const result = synthesize('[throat]', {
  tier: 'medium',
  seed: 1,
  markup: true,
});
const { samples, sampleRate, plan } = result;
const parts = plan.segments.filter(
  (segment) => segment.soundOf && segment.kind !== 'pause' && segment.soundPitch
);
for (const part of parts) {
  const slice = samples.subarray(
    Math.round(part.start * sampleRate),
    Math.round(part.end * sampleRate)
  );
  const f0 = Array.from(pitchTrack(slice, sampleRate)).filter((v) => v > 0);
  f0.sort((a, b) => a - b);
  console.log(
    part.token?.base ?? part.kind,
    (part.end - part.start).toFixed(2),
    'voiced',
    voicedShare(slice, sampleRate).toFixed(2),
    'median f0',
    (f0[Math.floor(f0.length / 2)] ?? 0).toFixed(0),
    f0.length
  );
}
