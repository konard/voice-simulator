// Unlicense. Nine finite recordings test zero-lag extrapolation of periodic ACF.
// Modulation lowers correlation approximately quadratically with lag. Two
// periodic lags can extrapolate it back to zero, where additive noise enters.
import { synthesize } from '../../src/synthesize.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { hann } from '../../src/recognition/inverse-dsp.js';
import { percentile } from '../../src/analysis/voice-features.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';

function correlations(x, centre, period, cycles) {
  const length = Math.round(cycles * period),
    window = hann(length);
  const start = centre - Math.floor(length / 2);
  const mean =
    window.reduce((sum, _, i) => sum + (x[start + i] ?? 0), 0) / length;
  const y = window.map((w, i) => w * ((x[start + i] ?? 0) - mean));
  const r0 = y.reduce((sum, v) => sum + v * v, 0);
  const w0 = window.reduce((sum, v) => sum + v * v, 0);
  const at = (lag) => {
    let r = 0,
      w = 0;
    for (let i = 0; i + lag < length; i++) {
      r += y[i] * y[i + lag];
      w += window[i] * window[i + lag];
    }
    return (r * w0) / Math.max(1e-20, r0 * w);
  };
  const cubic = (lag) => {
    const i = Math.floor(lag),
      u = lag - i;
    const a = at(i - 1),
      b = at(i),
      c = at(i + 1),
      d = at(i + 2);
    return (
      b +
      0.5 *
        u *
        (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
    );
  };
  return [cubic(period), cubic(2 * period), cubic(3 * period)];
}
const rows = [];
const short = 'The north wind and the sun.';
const long =
  'The north wind and the sun were disputing which was the stronger.';
for (const [name, text, head] of [
  ...[0, 0.25, 0.5, 0.75, 1].map((breathiness) => [
    String(breathiness),
    MATCH_TEXT,
    { breathiness },
  ]),
  [
    'A',
    short,
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  ],
  [
    'B',
    short,
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ],
  ['female', long, presetHeadConfig('female')],
  ['male', long, presetHeadConfig('male')],
]) {
  const audio = synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const frames = analyzeFrames(audio.samples, 16000),
    pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch });
  const stats = {};
  for (const cycles of [6, 8]) {
    const values = [[], [], []];
    for (let t = 0; t < frames.count; t += 2) {
      if (!source.reliable[t]) {
        continue;
      }
      const [a, b, c] = correlations(
        frames.samples,
        Math.round(t * frames.hop * frames.rate),
        frames.rate / pitch.f0[t],
        cycles
      );
      for (const [j, correlation] of [
        a,
        (4 * a - b) / 3,
        (15 * a - 6 * b + c) / 10,
      ].entries()) {
        const rho = Math.max(0.001, Math.min(0.9999, correlation));
        values[j].push(10 * Math.log10(rho / (1 - rho)));
      }
    }
    values.forEach(
      (v, j) =>
        (stats[`${cycles}-${j}`] = {
          frames: v.length,
          hnr: percentile(v, 0.5),
        })
    );
  }
  rows.push({ name, breathiness: head.breathiness ?? 0.2, stats });
}
for (const row of rows) {
  for (const key of Object.keys(row.stats)) {
    row.stats[key].breathiness = tableInverse(
      row.stats[key].hnr,
      rows.slice(0, 5).map((r) => [r.breathiness, r.stats[key].hnr])
    );
  }
  console.log(JSON.stringify(row));
}
