// Noise floor cap of the front end (issue 58). The issue says the floor is
// "never above the highest energy so far minus 25". Read literally, the floor
// of pure noise can never come within 25 dB of the noise itself, so the test
// "tracks the noise floor" (within 3 dB after 2 s) cannot pass and every
// noise frame is 9 dB above the floor, that is "speech". The front end caps
// the floor at the loudest frame already flagged as speech minus 25 dB
// instead. This script prints both readings on the inputs of the tests.
// Usage: node experiments/issue-58-noise-cap.mjs
import { analyzeFrames, createRandom, synthesize } from '../src/index.js';

function whiteNoise(length, level, seed) {
  const random = createRandom(seed);
  const amplitude = 10 ** (level / 20) * Math.sqrt(3);
  return Float32Array.from({ length }, () => (random() * 2 - 1) * amplitude);
}

function report(name, frames, from) {
  let peak = -Infinity;
  let literalSpeech = 0;
  let speech = 0;
  let worst = 0;
  let worstLiteral = 0;
  let total = 0;
  let power = 0;
  for (let t = 0; t < frames.count; t++) {
    power += 10 ** (frames.energy[t] / 10);
  }
  const mean = 10 * Math.log10(power / frames.count);
  for (let t = 0; t < frames.count; t++) {
    peak = Math.max(peak, frames.energy[t]);
    const literal = Math.min(frames.noise[t], peak - 25);
    if (t * frames.hop < from) {
      continue;
    }
    total++;
    speech += frames.speech[t];
    literalSpeech += frames.energy[t] - literal >= 9 ? 1 : 0;
    worst = Math.max(worst, Math.abs(frames.noise[t] - mean));
    worstLiteral = Math.max(worstLiteral, Math.abs(literal - mean));
  }
  console.log(`${name}: frames after ${from} s: ${total}`);
  console.log(
    `  cap at loudest speech - 25 dB: speech ${speech}, largest |noise - mean energy| ${worst.toFixed(2)} dB`
  );
  console.log(
    `  literal cap (loudest frame - 25 dB): speech ${literalSpeech}, largest |noise - mean energy| ${worstLiteral.toFixed(2)} dB`
  );
}

report(
  '3 s of white noise at -30 dB',
  analyzeFrames(whiteNoise(48000, -30, 3), 16000),
  2
);

const voice = synthesize('Hello world.', { tier: 'wideband' });
const pad = 8000;
const samples = whiteNoise(voice.samples.length + 2 * pad, -50, 58);
for (let n = 0; n < voice.samples.length; n++) {
  samples[pad + n] += voice.samples[n];
}
const frames = analyzeFrames(samples, 16000);
report(
  'Hello world. with -50 dB noise, leading noise',
  { ...frames, count: Math.round(0.5 / frames.hop) - 3 },
  0.3
);
let hits = 0,
  total = 0;
for (const s of voice.plan.segments) {
  if (s.kind !== 'vowel') {
    continue;
  }
  for (
    let t = Math.ceil((0.5 + s.start) / frames.hop);
    t * frames.hop < 0.5 + s.start + s.duration;
    t++
  ) {
    total++;
    hits += frames.speech[t];
  }
}
let after = 0,
  afterTotal = 0;
for (
  let t = Math.ceil((0.5 + voice.duration + 0.0625) / frames.hop);
  t < frames.count;
  t++
) {
  afterTotal++;
  after += frames.speech[t] ? 0 : 1;
}
console.log(
  `  vowel frames flagged speech: ${hits}/${total}; trailing noise frames flagged 0: ${after}/${afterTotal}`
);
