// Unlicense. g(prior) = dF tract estimate under a fixed formant prior, on a
// grid of priors; a split-invariant fixed point g(p) = p (issue 63).
import { synthesize } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const GRID = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
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
const texts = [
  MATCH_TEXT,
  'The north wind and the sun were disputing which was the stronger.',
];
for (const text of texts) {
  for (const tract of [12, 13.5, 15, 16.5, 18, 19]) {
    for (const extra of [
      {},
      { pitch: 220, tenseness: 0.4 },
      { pitch: 100, tenseness: 0.8, breathiness: 0.7 },
    ]) {
      const head = { vocalTractLength: tract, ...extra };
      const { samples } = synthesize(text, {
        head,
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const frames = analyzeFrames(Float32Array.from(samples), 16000),
        pitch = trackPitch(frames);
      const g = GRID.map((p) => lengthOf(frames, pitch, p));
      console.log(
        text.slice(0, 8),
        JSON.stringify(head),
        g.map((x, i) => (x - GRID[i]).toFixed(2)).join(' ')
      );
    }
  }
}
