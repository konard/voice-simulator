// Unlicense. Finite probe: five calibration voices and four target voices.
import { synthesize } from '../../src/synthesize.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { percentile } from '../../src/analysis/voice-features.js';
import {
  emptyState,
  addValue,
  medianSd,
} from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';

const short = 'The north wind and the sun.';
const long =
  'The north wind and the sun were disputing which was the stronger.';
const cases = [
  ...[0, 0.25, 0.5, 0.75, 1].map((breathiness) => [
    MATCH_TEXT,
    { breathiness },
  ]),
  [
    short,
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  ],
  [
    short,
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ],
  [long, presetHeadConfig('female')],
  [long, presetHeadConfig('male')],
];
for (const [text, head] of cases) {
  const audio = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  });
  const frames = analyzeFrames(audio.samples, 16000);
  const pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch });
  const rows = Array.from({ length: frames.count }, (_, t) => t).filter(
    (t) => source.reliable[t]
  );
  const masks = {};
  for (const slope of [Infinity, 0.01, 0.005, 0.002]) {
    const selected = rows.filter(
      (t) =>
        slope === Infinity ||
        (pitch.f0[t - 1] > 0 &&
          pitch.f0[t + 1] > 0 &&
          Math.abs(pitch.f0[t + 1] - pitch.f0[t - 1]) / pitch.f0[t] <= slope)
    );
    masks[slope] = {
      frames: selected.length,
      hnr: percentile(
        selected.map((t) => source.hnr[t]),
        0.5
      ),
      rd: percentile(
        selected.map((t) => source.rd[t]),
        0.5
      ),
    };
  }
  const pitchSds = {};
  for (const radius of [0, 2, 5, 10, 20]) {
    const state = emptyState();
    for (let t = 0; t < frames.count; t++) {
      if (pitch.f0[t]) {
        addValue(
          state,
          'f0',
          percentile(
            Array.from(
              pitch.f0.subarray(
                Math.max(0, t - radius),
                Math.min(frames.count, t + radius + 1)
              )
            ).filter((x) => x > 0),
            0.5
          )
        );
      }
    }
    pitchSds[radius] = medianSd(state, 'f0');
  }
  const landmarks = {};
  for (const dip of [2, 3, 4, 5]) {
    const measured = findLandmarks(frames, { thresholds: { nucleusDip: dip } });
    landmarks[dip] = measured.nuclei.map((n) => Number(n.time.toFixed(3)));
  }
  console.log(
    JSON.stringify({
      head,
      text,
      duration: audio.duration,
      masks,
      pitchSds,
      landmarks,
    })
  );
}
