// Unlicense. Syllable rate by the legacy envelope counter and by
// findLandmarks nuclei over texts, heads and speech rates (issue 63).
import { synthesize } from '../../src/synthesize.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { prepareLegacyVoice } from '../../src/analysis/voice-features.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = {
  match: MATCH_TEXT,
  north: 'The north wind and the sun.',
  passage: 'The north wind and the sun were disputing which was the stronger.',
};
const heads = {
  default: {},
  male: presetHeadConfig('male'),
  female: presetHeadConfig('female'),
  A: { vocalTractLength: 14, pitch: 210, tenseness: 0.45 },
  B: { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75 },
};
for (const [tn, text] of Object.entries(texts)) {
  for (const [hn, head] of Object.entries(heads)) {
    const row = [];
    for (const speechRate of [0.85, 1, 1.15]) {
      const { samples } = synthesize(text, {
        head: { ...head, speechRate },
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const legacy = prepareLegacyVoice(Float32Array.from(samples), 16000, {
        diagnosticsOnly: true,
      }).rateFeatures;
      const frames = analyzeFrames(Float32Array.from(samples), 16000);
      const lm = findLandmarks(frames);
      const speech = legacy.activeDuration + 0.03;
      row.push(
        `${speechRate}: legacy ${Math.round(legacy.syllableRate * legacy.activeDuration)}/${speech.toFixed(2)}s lm ${lm.nuclei.length}`
      );
    }
    console.log(tn, hn, row.join(' | '));
  }
}
