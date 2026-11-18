// Unlicense. Finite probe of pitch-dependent HNR window bias; no production changes.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { hnr, hann } from '../../src/recognition/inverse-dsp.js';
import { percentile } from '../../src/analysis/voice-features.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';

const windows = {
  periods2: (period) => 2 * period,
  periods3: (period) => 3 * period,
  periods6: (period) => 6 * period,
  cap30ms: (period, rate) =>
    Math.max(2 * period, Math.min(6 * period, 0.03 * rate)),
  cap40ms: (period, rate) =>
    Math.max(2 * period, Math.min(6 * period, 0.04 * rate)),
};
const rows = [];
for (const head of [
  ...[0, 0.25, 0.5, 0.75, 1].map((breathiness) => ({ breathiness })),
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
]) {
  const text =
    Object.keys(head).length === 1 ? MATCH_TEXT : 'The north wind and the sun.';
  const audio = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  });
  const frames = analyzeFrames(audio.samples, 16000),
    pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch });
  const row = { head };
  for (const [name, size] of Object.entries(windows)) {
    const values = [];
    for (let t = 0; t < frames.count; t++) {
      if (!source.reliable[t]) {
        continue;
      }
      const period = frames.rate / pitch.f0[t];
      values.push(
        hnr(
          frames.samples,
          Math.round(t * frames.hop * frames.rate),
          period,
          hann(Math.round(size(period, frames.rate)))
        )
      );
    }
    row[name] = percentile(values, 0.5);
  }
  rows.push(row);
}
for (const row of rows) {
  for (const name of Object.keys(windows)) {
    row[`${name}Breathiness`] = tableInverse(
      row[name],
      rows.slice(0, 5).map((r) => [r.head.breathiness, r[name]])
    );
  }
  console.log(JSON.stringify(row));
}
