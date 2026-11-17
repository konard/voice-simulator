// Unlicense. Bounded cycle-pair HNR probe; no production calibration changes.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { percentile } from '../../src/analysis/voice-features.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
function cubic(x, at) {
  const i = Math.floor(at),
    u = at - i;
  const a = x[i - 1] ?? 0,
    b = x[i] ?? 0,
    c = x[i + 1] ?? 0,
    d = x[i + 2] ?? 0;
  return (
    b +
    0.5 *
      u *
      (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
  );
}
function measure(x, centre, period, periods, search) {
  const n = Math.round(periods * period);
  let best = 0;
  for (let step = search ? -4 : 0; step <= (search ? 4 : 0); step++) {
    const lag = period * (1 + step * 0.005);
    let weight = 0,
      a = 0,
      b = 0,
      aa = 0,
      bb = 0,
      ab = 0;
    for (let k = 0; k < n; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
      const at = centre + k - n / 2;
      const u = cubic(x, at - lag / 2),
        v = cubic(x, at + lag / 2);
      weight += w;
      a += w * u;
      b += w * v;
      aa += w * u * u;
      bb += w * v * v;
      ab += w * u * v;
    }
    const rho =
      (ab - (a * b) / weight) /
      Math.sqrt((aa - (a * a) / weight) * (bb - (b * b) / weight));
    if (Number.isFinite(rho)) {
      best = Math.max(best, rho);
    }
  }
  const rho = Math.max(0.001, Math.min(0.999, best));
  return 10 * Math.log10(rho / (1 - rho));
}
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
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const frames = analyzeFrames(audio.samples, 16000),
    pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch }),
    row = { head };
  for (const periods of [1, 2, 3]) {
    for (const search of [false, true]) {
      const values = [],
        stable = [];
      for (let t = 1; t < frames.count - 1; t += 2) {
        if (!source.reliable[t]) {
          continue;
        }
        const value = measure(
          frames.samples,
          t * frames.hop * frames.rate,
          frames.rate / pitch.f0[t],
          periods,
          search
        );
        values.push(value);
        if (
          pitch.f0[t - 1] > 0 &&
          pitch.f0[t + 1] > 0 &&
          Math.abs(pitch.f0[t + 1] - pitch.f0[t - 1]) / pitch.f0[t] < 0.005
        ) {
          stable.push(value);
        }
      }
      row[`${periods}-${search}`] = percentile(values, 0.5);
      row[`${periods}-${search}-stable`] = percentile(stable, 0.5);
    }
  }
  rows.push(row);
}
for (const row of rows) {
  for (const key of Object.keys(row).filter((k) => k !== 'head')) {
    row[`${key}-breathiness`] = tableInverse(
      row[key],
      rows.slice(0, 5).map((r) => [r.head.breathiness, r[key]])
    );
  }
  console.log(JSON.stringify(row));
}
