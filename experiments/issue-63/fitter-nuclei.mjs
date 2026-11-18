// Unlicense. Issue 63: fitter state nuclei (whole, two and three updates)
// against findLandmarks on the whole recording.
import { synthesize, createVoiceFitter } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { totalNuclei } from '../../src/analysis/voice-fit-nuclei.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const A = {
  vocalTractLength: 14,
  pitch: 210,
  tenseness: 0.45,
  speechRate: 1.15,
};
const B = {
  vocalTractLength: 18.5,
  pitch: 100,
  tenseness: 0.75,
  speechRate: 0.9,
};
for (const [name, text, head] of [
  ['A', 'The north wind and the sun.', A],
  ['B', 'The north wind and the sun.', B],
  ['default', MATCH_TEXT, {}],
  ['A long', MATCH_TEXT, A],
]) {
  const { samples, sampleRate } = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
  });
  const row = {
    name,
    landmarks: findLandmarks(analyzeFrames(samples, sampleRate)).nuclei.length,
  };
  for (const parts of [1, 2, 3]) {
    let state;
    const step = Math.floor(samples.length / parts);
    for (let i = 0; i < parts; i++) {
      const f = createVoiceFitter(
        state ? { state: JSON.parse(JSON.stringify(state)) } : {}
      );
      f.update(
        samples.subarray(
          i * step,
          i === parts - 1 ? samples.length : (i + 1) * step
        ),
        sampleRate
      );
      state = f.state;
    }
    row[`parts${parts}`] = totalNuclei(state);
    if (parts === 2) {
      row.stateBytes = JSON.stringify(state).length;
    }
  }
  console.log(JSON.stringify(row));
}
