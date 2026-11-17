// Unlicense. Bounded probe of fractional-lag and pitch-slope HNR bias.
// This does not replace the required inverseFilter HNR or change fit gates.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { tableInverse } from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const median = (x) => {
  x.sort((a, b) => a - b);
  return (
    (x[Math.floor((x.length - 1) / 2)] + x[Math.ceil((x.length - 1) / 2)]) / 2
  );
};
function cubic(x, at) {
  const i = Math.floor(at),
    u = at - i;
  const [a, b, c, d] = [-1, 0, 1, 2].map((k) => x[i + k] ?? 0);
  return (
    b +
    0.5 *
      u *
      (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
  );
}
function measure(x, rate, centre, f0, slope, search = false) {
  const period = rate / f0,
    length = Math.round(6 * period);
  const signal = new Float64Array(length);
  const window = new Float64Array(length);
  let mean = 0;
  for (let n = 0; n < length; n++) {
    const t = (n - length / 2) / rate;
    signal[n] = cubic(x, centre + (t - (slope / (2 * f0)) * t * t) * rate);
    mean += signal[n] / length;
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
  }
  let power = 0,
    w0 = 0;
  for (let n = 0; n < length; n++) {
    signal[n] = (signal[n] - mean) * window[n];
    power += signal[n] ** 2;
    w0 += window[n] ** 2;
  }
  let best = -Infinity;
  // At most 17 lags, within 4% of the independently measured pitch period.
  for (let step = search ? -8 : 0; step <= (search ? 8 : 0); step++) {
    const lag = period * (1 + step * 0.005);
    let r = 0,
      w = 0;
    for (let n = 0; n + lag < length; n++) {
      r += signal[n] * cubic(signal, n + lag);
      w += window[n] * cubic(window, n + lag);
    }
    best = Math.max(best, (r * w0) / (power * w));
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
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const frames = analyzeFrames(audio.samples, 16000),
    pitch = trackPitch(frames);
  const source = inverseFilter(frames, { pitch }),
    values = [],
    warped = [],
    searched = [];
  // Every fourth frame keeps this diagnostic small; all cases use the same rule.
  for (let t = 0; t < frames.count; t += 4) {
    if (!source.reliable[t]) {
      continue;
    }
    const f0 = pitch.f0[t],
      centre = t * frames.hop * frames.rate;
    const before = pitch.f0[t - 1],
      after = pitch.f0[t + 1];
    const slope =
      before > 0 && after > 0
        ? Math.max(
            -4 * f0,
            Math.min(4 * f0, (after - before) / (2 * frames.hop))
          )
        : 0;
    values.push(measure(frames.samples, frames.rate, centre, f0, 0));
    warped.push(measure(frames.samples, frames.rate, centre, f0, slope));
    searched.push(
      measure(frames.samples, frames.rate, centre, f0, slope, true)
    );
  }
  rows.push({
    head,
    original: source.summary.hnr.median,
    cubic: median(values),
    warped: median(warped),
    searched: median(searched),
  });
}
for (const row of rows) {
  for (const key of ['original', 'cubic', 'warped', 'searched']) {
    row[`${key}Breathiness`] = tableInverse(
      row[key],
      rows.slice(0, 5).map((r) => [r.head.breathiness, r[key]])
    );
  }
  console.log(JSON.stringify(row));
}
