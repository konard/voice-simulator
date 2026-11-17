// Unlicense. Bounded pitch-window/voicing probe, preserving the MAD formula.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import {
  addValue,
  emptyState,
  quantile,
  medianSd,
} from '../../src/analysis/voice-fit-statistics.js';
const { samples } = synthesize('The north wind and the sun.', {
  head: { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  sampleRate: 16000,
  solver: 'waveguide',
  engine: 'js',
  seed: 1,
});
const frames = analyzeFrames(samples, 16000);
for (const minF0 of [40, 50, 60, 75, 90]) {
  for (const voicingThreshold of [0.45, 0.6, 0.75]) {
    const pitch = trackPitch(frames, { minF0, voicingThreshold }),
      state = emptyState();
    for (const f0 of pitch.f0) {
      if (f0 > 0) {
        addValue(state, 'f0', f0);
        state.voicedFrames++;
      }
    }
    console.log(
      JSON.stringify({
        minF0,
        voicingThreshold,
        frames: state.voicedFrames,
        pitch: quantile(state, 'f0'),
        sd: medianSd(state, 'f0'),
      })
    );
  }
}
