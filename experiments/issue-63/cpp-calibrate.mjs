// Unlicense. Median inverse-filter CPP of default-head renders of MATCH_TEXT
// over breathiness x pitch (issue 63): a pitch-conditioned breathiness table.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const median = (v) => {
  const s = v.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const text = process.argv[2] ?? MATCH_TEXT;
const pitches = (process.argv[3] ?? '80,110,150,210,290')
  .split(',')
  .map(Number);
const breaths = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
for (const pitch of pitches) {
  const row = [];
  for (const breathiness of breaths) {
    const { samples } = synthesize(text, {
      head: { pitch, breathiness },
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const frames = analyzeFrames(Float32Array.from(samples), 16000),
      p = trackPitch(frames);
    const src = inverseFilter(frames, { pitch: p });
    const cpp = [],
      hnr = [];
    for (let t = 0; t < frames.count; t++) {
      if (p.f0[t] > 0 && src.reliable[t]) {
        cpp.push(src.cpp[t]);
        hnr.push(src.hnr[t]);
      }
    }
    row.push(+median(cpp).toFixed(3));
  }
  console.log(JSON.stringify({ pitch, cpp: row }));
}
