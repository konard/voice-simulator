// Unlicense. Compare the uncertainty gate with the renderer's known f0 plan.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import {
  emptyState,
  addValue,
  quantile,
  medianSd,
} from '../../src/analysis/voice-fit-statistics.js';
const audio = synthesize('The north wind and the sun.', {
  head: { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  sampleRate: 16000,
  solver: 'waveguide',
  seed: 1,
  engine: 'js',
});
const frames = analyzeFrames(audio.samples, 16000);
const pitch = trackPitch(frames);
for (const mode of ['tracked', 'planAtTrackedFrames', 'planVoicing']) {
  const state = emptyState();
  const values = [];
  for (let t = 0; t < frames.count; t++) {
    const i = Math.min(
      audio.plan.frameCount - 1,
      Math.round(t * frames.hop * audio.plan.frameRate)
    );
    const voiced =
      mode === 'planVoicing'
        ? audio.plan.channels.voicing[i] > 0.5
        : pitch.f0[t] > 0;
    if (voiced) {
      const value =
        mode === 'tracked' ? pitch.f0[t] : audio.plan.channels.f0[i];
      addValue(state, 'f0', value);
      values.push(value);
    }
  }
  const median = (x) => {
    x.sort((a, b) => a - b);
    return (
      (x[Math.floor((x.length - 1) / 2)] + x[Math.ceil((x.length - 1) / 2)]) / 2
    );
  };
  const centre = median(values);
  const rawMad = median(values.map((x) => Math.abs(x - centre)));
  console.log(
    JSON.stringify({
      mode,
      frames: state.histograms.f0.reduce((a, b) => a + b, 0),
      pitch: quantile(state, 'f0'),
      sd: medianSd(state, 'f0'),
      rawMedian: centre,
      rawMad,
      rawSd: (1.4826 * rawMad) / Math.sqrt(values.length / 20),
    })
  );
}
