// Unlicense. dF tract length versus the formant tracker's length prior:
// fixed 16.5 cm, the true length, adaptive (null) and a fixed-point
// iteration that feeds each dF estimate back as the next prior (issue 63).
import { synthesize } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const lengthOf = (frames, pitch, prior) => {
  const f = trackFormants(frames, { pitch, vocalTractLength: prior });
  const v = [];
  for (let t = 0; t < frames.count; t++) {
    if (
      !(pitch.f0[t] > 0) ||
      f.nasal[t] ||
      ![0, 1, 2].every((k) => f.valid[t * 4 + k])
    ) {
      continue;
    }
    v.push(
      [0, 1, 2].reduce((s, k) => s + f.frequency[t * 4 + k] * (k + 0.5), 0) /
        8.75
    );
  }
  v.sort((a, b) => a - b);
  return v.length ? 17500 / v[Math.floor(v.length / 2)] : NaN;
};
const texts = [MATCH_TEXT, 'The north wind and the sun.'];
for (const text of texts) {
  for (const head of [
    { vocalTractLength: 12 },
    { vocalTractLength: 14 },
    {},
    { vocalTractLength: 18.5 },
    { vocalTractLength: 20 },
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ]) {
    const { samples } = synthesize(text, {
      head,
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const frames = analyzeFrames(Float32Array.from(samples), 16000),
      pitch = trackPitch(frames);
    const truth = head.vocalTractLength ?? 16.5;
    const fixed = lengthOf(frames, pitch, 16.5),
      atTruth = lengthOf(frames, pitch, truth);
    const iter = [fixed];
    for (let i = 0; i < 4; i++) {
      iter.push(
        lengthOf(frames, pitch, Math.max(10, Math.min(20, iter.at(-1))))
      );
    }
    console.log(
      text.slice(0, 12),
      JSON.stringify(head),
      'fixed16.5',
      fixed.toFixed(2),
      'truthPrior',
      atTruth.toFixed(2),
      'iter',
      iter.map((x) => x.toFixed(2)).join(',')
    );
  }
}
