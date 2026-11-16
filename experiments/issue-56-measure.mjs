// Issue 56: the numbers of docs/markup.md (Sounds, Measured) that the
// other issue-56 experiments do not print: the f0 of the laugh calls, the
// level of an inhale against the vowel of "Yes" and a whispered laugh.
// node experiments/issue-56-measure.mjs
import { levelDb, pitchTrack, synthesize, voicedShare } from '../src/index.js';

const BASE = { tier: 'medium', seed: 1, markup: true };
const median = (values) => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const part = (result, from, to) =>
  result.samples.subarray(
    Math.round(from * result.sampleRate),
    Math.round(to * result.sampleRate)
  );

const laugh = synthesize('Yes [laugh]', BASE);
const calls = laugh.plan.segments.filter(
  (s) => s.soundOf?.sound === 'laugh' && s.kind === 'vowel'
);
const f0 = calls.map((s) =>
  median(Array.from(pitchTrack(part(laugh, s.start, s.end), laugh.sampleRate)))
);
console.log(
  'laugh calls f0',
  f0.map((v) => v.toFixed(0)).join(' '),
  'Hz; first / head.pitch',
  (f0[0] / laugh.head.pitch).toFixed(3),
  'head.pitch',
  laugh.head.pitch
);

const inhale = synthesize('[inhale] Yes', BASE);
const sound = inhale.plan.sounds[0];
const vowel = inhale.plan.segments.find(
  (s) => s.kind === 'vowel' && !s.soundOf
);
const breath = part(inhale, sound.start, sound.end);
const breathLevel = levelDb(breath, 0, breath.length);
const vowelSamples = part(inhale, vowel.start, vowel.end);
const vowelLevel = levelDb(vowelSamples, 0, vowelSamples.length);
console.log(
  'inhale',
  (sound.end - sound.start).toFixed(3),
  's, voiced',
  voicedShare(breath, inhale.sampleRate).toFixed(3),
  ', level',
  breathLevel.toFixed(1),
  'dBFS,',
  (vowelLevel - breathLevel).toFixed(1),
  'dB below the vowel of Yes'
);

const whisper = synthesize('[whisper]Yes [laugh][/whisper]', BASE);
const whispered = whisper.plan.sounds.find((s) => s.name === 'laugh');
console.log(
  'whispered laugh voiced',
  voicedShare(
    part(whisper, whispered.start, whispered.end),
    whisper.sampleRate
  ).toFixed(3)
);
