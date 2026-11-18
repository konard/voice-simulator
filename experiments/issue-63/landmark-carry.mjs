// Unlicense. Issue 63: landmark nuclei counted per update with a carried
// audio tail (context C, held back H) versus one whole-recording count.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const C = +(process.argv[2] ?? 0.6),
  H = +(process.argv[3] ?? 0.3);
function counter(sampleRate) {
  let carry = new Float32Array(0),
    nuclei = 0;
  const count = (input, from, to) => {
    const frames = analyzeFrames(input, sampleRate);
    return findLandmarks(frames).nuclei.filter(
      (n) => n.time >= from && n.time < to
    ).length;
  };
  return {
    update(chunk) {
      const input = new Float32Array(carry.length + chunk.length);
      input.set(carry);
      input.set(chunk, carry.length);
      const length = input.length / sampleRate;
      const from = carry.length ? carry.length / sampleRate - H : 0;
      nuclei += count(input, from, length - H);
      carry = input.slice(
        Math.max(0, input.length - Math.round(C * sampleRate))
      );
    },
    result() {
      const length = carry.length / sampleRate;
      return nuclei + count(carry, Math.max(0, length - H), Infinity);
    },
  };
}
for (const [name, text, head] of [
  ['default', MATCH_TEXT, {}],
  [
    'A',
    'The north wind and the sun.',
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  ],
  [
    'B',
    'The north wind and the sun.',
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ],
  [
    'A long',
    MATCH_TEXT,
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  ],
  [
    'B long',
    MATCH_TEXT,
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ],
]) {
  const { samples, sampleRate } = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const plain = findLandmarks(analyzeFrames(samples, sampleRate)).nuclei.length;
  const whole = counter(sampleRate);
  whole.update(samples);
  const out = { name, plain, whole: whole.result() };
  for (const parts of [2, 3]) {
    const c = counter(sampleRate),
      step = Math.floor(samples.length / parts);
    for (let i = 0; i < parts; i++) {
      c.update(
        samples.subarray(
          i * step,
          i === parts - 1 ? samples.length : (i + 1) * step
        )
      );
    }
    out[`split${parts}`] = c.result();
  }
  console.log(JSON.stringify(out));
}
