import { performance } from 'node:perf_hooks';
// Unlicense. Baseline analysis and calibration probe for issue 63.
import { synthesize } from '../../src/synthesize.js';
import { analyzeVoice, median } from '../../src/analysis/voice-features.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { trackFormants } from '../../src/recognition/formants.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';

const text = 'The north wind and the sun.';
for (const head of [
  {},
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ...[0, 0.25, 0.5, 0.75, 1].map((breathiness) => ({ breathiness })),
]) {
  const { samples, sampleRate } = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const start = performance.now();
  const frames = analyzeFrames(samples, sampleRate);
  const pitch = trackPitch(frames);
  const formants = trackFormants(frames, { pitch });
  const source = inverseFilter(frames, { pitch });
  const spacings = [];
  for (let t = 0; t < frames.count; t++) {
    if (
      pitch.f0[t] > 0 &&
      !formants.nasal[t] &&
      [0, 1, 2].every((k) => formants.valid[t * 4 + k])
    ) {
      spacings.push(
        [0, 1, 2].reduce(
          (sum, k) => sum + formants.frequency[t * 4 + k] * (k + 0.5),
          0
        ) / 8.75
      );
    }
  }
  const seconds = samples.length / sampleRate;
  console.log(
    JSON.stringify({
      head,
      seconds,
      rtf: (performance.now() - start) / 1000 / seconds,
      pitch: [pitch.median, pitch.low, pitch.high, pitch.jitter, pitch.shimmer],
      length: 17500 / median(spacings),
      trackerLength: formants.vocalTractLength,
      source: source.summary,
      legacy: analyzeVoice(samples, sampleRate),
    })
  );
}
