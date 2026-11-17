// Unlicense. Bounded comparison of signals used for calibrated source HNR.
import { synthesize } from '../../src/synthesize.js';
import { Biquad } from '../../src/acoustics/filters.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { hnr, hann } from '../../src/recognition/inverse-dsp.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const median = (x) => {
  x.sort((a, b) => a - b);
  return (
    (x[Math.floor((x.length - 1) / 2)] + x[Math.ceil((x.length - 1) / 2)]) / 2
  );
};
const rows = [];
for (const head of [
  ...[0, 0.25, 0.5, 0.75, 1].map((breathiness) => ({ breathiness })),
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
]) {
  const audio = synthesize(
    Object.keys(head).length === 1 ? MATCH_TEXT : 'The north wind and the sun.',
    {
      head,
      sampleRate: 16000,
      solver: 'waveguide',
      seed: 1,
      engine: 'js',
    }
  );
  const frames = analyzeFrames(audio.samples, 16000);
  const pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch });
  const filter = new Biquad();
  filter.highpass(400, Math.SQRT1_2, frames.rate);
  const signals = {
    speech: frames.samples,
    highpass: Float64Array.from(frames.samples, (x) => filter.process(x)),
    derivative: source.flowDerivative,
  };
  const row = { head };
  for (const [name, signal] of Object.entries(signals)) {
    const values = [];
    for (let t = 0; t < frames.count; t += 4) {
      if (!source.reliable[t]) {
        continue;
      }
      const period = frames.rate / pitch.f0[t];
      values.push(
        hnr(
          signal,
          Math.round(t * frames.hop * frames.rate),
          period,
          hann(Math.round(6 * period))
        )
      );
    }
    row[name] = median(values);
  }
  rows.push(row);
}
for (const row of rows) {
  for (const key of ['speech', 'highpass', 'derivative']) {
    row[`${key}Breathiness`] = tableInverse(
      row[key],
      rows.slice(0, 5).map((r) => [r.head.breathiness, r[key]])
    );
  }
  console.log(JSON.stringify(row));
}
