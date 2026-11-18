// Unlicense. Render only the default head; no target-head fitting.
import { synthesize } from '../../src/synthesize.js';
import {
  analyzeLegacyVoice,
  percentile,
} from '../../src/analysis/voice-features.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
for (const text of [MATCH_TEXT, 'The north wind and the sun.']) {
  for (const breathiness of [0, 0.2, 0.25, 0.5, 0.75, 1]) {
    const { samples, sampleRate } = synthesize(text, {
      head: { breathiness },
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
      seed: 1,
    });
    const frames = analyzeFrames(samples, sampleRate),
      pitch = trackPitch(frames);
    const source = inverseFilter(frames, { pitch }),
      landmarks = findLandmarks(frames),
      legacy = analyzeLegacyVoice(samples, sampleRate);
    const steady = Array.from(source.hnr).filter(
      (_, t) =>
        source.reliable[t] &&
        pitch.f0[t - 1] > 0 &&
        pitch.f0[t + 1] > 0 &&
        Math.abs(pitch.f0[t + 1] - pitch.f0[t - 1]) / pitch.f0[t] < 0.005
    );
    console.log(
      JSON.stringify({
        text,
        breathiness,
        hnr: source.summary.hnr.median,
        steadyHnr: percentile(steady, 0.5),
        range: 12 * Math.log2(pitch.high / pitch.low),
        rangeFactor: 3 / (12 * Math.log2(pitch.high / pitch.low)),
        syllableRate: legacy.syllableRate,
        pooledSyllableRate:
          Math.round(legacy.syllableRate * legacy.activeDuration) /
          (legacy.activeDuration + 0.03),
        landmarkNuclei: landmarks.nuclei.length,
        landmarkSyllableRate:
          landmarks.nuclei.length / (legacy.activeDuration + 0.03),
        h1h2: legacy.h1h2,
        legacyHnr: legacy.hnr,
      })
    );
  }
}
