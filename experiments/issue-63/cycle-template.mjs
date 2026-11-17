// Unlicense. Finite diagnostic of period-aligned HNR: nine short recordings.
import { synthesize } from '../../src/synthesize.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { percentile } from '../../src/analysis/voice-features.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';

function sample(x, at) {
  const i = Math.floor(at),
    u = at - i;
  const a = x[i - 1] ?? 0,
    b = x[i] ?? 0;
  const c = x[i + 1] ?? 0,
    d = x[i + 2] ?? 0;
  return (
    b +
    0.5 *
      u *
      (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
  );
}

// Regress out slow cycle-to-cycle waveform changes before estimating noise.
// Symmetric linear and centered quadratic bases are mutually orthogonal.
function measure(waves, degree) {
  const count = waves.length;
  const x = waves.map((_, j) => j - (count - 1) / 2);
  const meanSquare = x.reduce((sum, t) => sum + t * t, 0) / count;
  const q = x.map((t) => t * t - meanSquare);
  const norm = (a) => a.reduce((sum, v) => sum + v * v, 0);
  let noise = 0,
    signal = 0;
  for (let k = 0; k < waves[0].length; k++) {
    const centre = waves.reduce((sum, w) => sum + w[k], 0) / count;
    const linear =
      degree > 0
        ? waves.reduce((sum, w, j) => sum + x[j] * w[k], 0) / norm(x)
        : 0;
    const quadratic =
      degree > 1
        ? waves.reduce((sum, w, j) => sum + q[j] * w[k], 0) / norm(q)
        : 0;
    noise +=
      waves.reduce(
        (sum, w, j) =>
          sum + (w[k] - centre - linear * x[j] - quadratic * q[j]) ** 2,
        0
      ) /
      (count - degree - 1);
    signal += centre ** 2;
  }
  return 10 * Math.log10(Math.max(1e-8, (signal - noise / count) / noise));
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
    p = trackPitch(frames);
  const stats = {};
  for (const cycles of [3, 5, 7]) {
    const values = Array.from({ length: Math.min(3, cycles - 1) }, () => []);
    for (let first = 0; first + cycles < p.marks.length; first += 2) {
      const marks = p.marks.subarray(first, first + cycles + 1);
      const periods = Array.from(marks.slice(1), (t, i) => t - marks[i]);
      const mean = periods.reduce((a, b) => a + b, 0) / cycles;
      if (periods.some((t) => Math.abs(t / mean - 1) > 0.08)) {
        continue;
      }
      const n = Math.min(128, Math.round(frames.rate * mean));
      const waves = periods.map((period, j) => {
        const wave = Float64Array.from({ length: n }, (_, k) =>
          sample(frames.samples, (marks[j] + (k / n) * period) * frames.rate)
        );
        const dc = wave.reduce((a, b) => a + b, 0) / n;
        const rms = Math.sqrt(wave.reduce((a, b) => a + (b - dc) ** 2, 0) / n);
        return wave.map((v) => (v - dc) / Math.max(1e-12, rms));
      });
      values.forEach((v, degree) => v.push(measure(waves, degree)));
    }
    values.forEach(
      (v, degree) =>
        (stats[`${cycles}-${degree}`] = {
          frames: v.length,
          hnr: percentile(v, 0.5),
        })
    );
  }
  rows.push({ name, head, stats });
}
for (const row of rows) {
  for (const key of Object.keys(row.stats)) {
    row.stats[key].breathiness = tableInverse(
      row.stats[key].hnr,
      rows.slice(0, 5).map((r) => [r.head.breathiness, r.stats[key].hnr])
    );
  }
  console.log(JSON.stringify(row));
}
