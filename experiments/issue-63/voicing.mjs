// Unlicense. Inspect the track's soft voicing scores; do not alter estimator gates.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import {
  addValue,
  emptyState,
  quantile,
  medianSd,
} from '../../src/analysis/voice-fit-statistics.js';
const a = synthesize('The north wind and the sun.', {
  head: { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  sampleRate: 16000,
  solver: 'waveguide',
  engine: 'js',
  seed: 1,
});
const f = analyzeFrames(a.samples, 16000),
  p = trackPitch(f);
for (const threshold of [0, 0.25, 0.5, 0.65, 0.75, 0.9]) {
  const s = emptyState();
  for (let t = 0; t < f.count; t++) {
    if (p.f0[t] > 0 && p.voicing[t] >= threshold) {
      addValue(s, 'f0', p.f0[t]);
      s.voicedFrames++;
    }
  }
  console.log({
    threshold,
    frames: s.voicedFrames,
    pitch: quantile(s, 'f0'),
    sd: medianSd(s, 'f0'),
  });
}
