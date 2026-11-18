// Unlicense. Bounded, stage-specific timing of one voice-fit analysis.
import { performance } from 'node:perf_hooks';
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { analyzeLegacyVoice } from '../../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
function measure(name, callback) {
  const start = performance.now();
  const result = callback();
  console.log(
    JSON.stringify({ name, seconds: (performance.now() - start) / 1000 })
  );
  return result;
}
const audio = measure('synthesize', () =>
  synthesize(MATCH_TEXT, {
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  })
);
const frames = measure('frontend', () => analyzeFrames(audio.samples, 16000));
const pitch = measure('pitch', () => trackPitch(frames));
measure('formants', () => trackFormants(frames, { pitch }));
measure('inverseFilter', () => inverseFilter(frames, { pitch }));
measure('legacyDiagnostics', () =>
  analyzeLegacyVoice(audio.samples, 16000, {
    diagnosticsOnly: true,
  })
);
