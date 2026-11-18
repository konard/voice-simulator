// Unlicense. Compare the merged landmark detector with the legacy rate fallback.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { analyzeLegacyVoice } from '../../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';

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
]) {
  const { samples, sampleRate } = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  for (const [stretch, input] of [
    ['whole', samples],
    ['first', samples.subarray(0, Math.floor(samples.length / 2))],
    ['second', samples.subarray(Math.floor(samples.length / 2))],
  ]) {
    const frames = analyzeFrames(input, sampleRate),
      landmarks = findLandmarks(frames),
      legacy = analyzeLegacyVoice(input, sampleRate, {
        sourceDiagnostics: false,
      });
    console.log(
      JSON.stringify({
        name,
        stretch,
        duration: input.length / sampleRate,
        nuclei: landmarks.nuclei.length,
        legacyNuclei: Math.round(legacy.syllableRate * legacy.activeDuration),
        speechSeconds: Math.min(
          input.length / sampleRate,
          legacy.activeDuration + 0.03
        ),
        frameSpeechSeconds:
          Array.from(frames.speech).filter(Boolean).length * frames.hop,
      })
    );
  }
}
