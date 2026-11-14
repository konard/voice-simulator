// Issue 32: why the HNR of a noise-free synthesized vowel stayed near 20 dB.
// Frames of a gliding [aː] (default prosody, no jitter, shimmer or vibrato)
// are straightened with the pitch slope from the neighbouring frames, then
// their aperiodicity is read at YIN's integer lag and at the best fractional
// lag (cubic interpolation, searched in steps of 0.05 samples).
// Run: node experiments/issue-32-fractional-lag.mjs > experiments/issue-32-fractional-lag.txt
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { resample, yinPitch } from '../src/analysis/voice-features.js';

function cubicAt(signal, position) {
  const index = Math.floor(position);
  const x = position - index;
  const at = (o) =>
    signal[Math.min(signal.length - 1, Math.max(0, index + o))] ?? 0;
  const [p0, p1, p2, p3] = [at(-1), at(0), at(1), at(2)];
  return (
    p1 +
    0.5 *
      x *
      (p2 -
        p0 +
        x * (2 * p0 - 5 * p1 + 4 * p2 - p3 + x * (3 * (p1 - p2) + p3 - p0)))
  );
}

function straighten(signal, start, length, rate, slope, f0) {
  const output = new Float64Array(length);
  const warp = slope / (2 * f0);
  for (let n = 0; n < length; n++) {
    const t = (n - length / 2) / rate;
    output[n] = cubicAt(signal, start + length / 2 + (t - warp * t * t) * rate);
  }
  return output;
}

function fractional(signal, length, period) {
  let mean = 0;
  const lags = Math.round(period);
  for (let lag = 1; lag <= lags; lag++) {
    for (let n = 0; n < length; n++) {
      mean += (signal[n] - signal[n + lag]) ** 2;
    }
  }
  mean /= lags;
  let best = Infinity;
  for (let lag = period - 1; lag <= period + 1; lag += 0.05) {
    let sum = 0;
    for (let n = 0; n < length; n++) {
      sum += (signal[n] - cubicAt(signal, n + lag)) ** 2;
    }
    best = Math.min(best, sum / mean);
  }
  return best;
}

const decibels = (d) => (10 * Math.log10((1 - d) / d)).toFixed(1);
for (const breathiness of [0, 0.25]) {
  const head = normalizeHeadConfig({
    vibrato: 0,
    jitter: 0,
    shimmer: 0,
    breathiness,
  });
  const plan = planUtterance('aː', { head });
  const audio = renderPlan(plan, {
    sampleRate: 44100,
    head,
    solver: 'waveguide',
    sections: 44,
    seed: 1,
  });
  const { samples, sampleRate: rate } = resample(audio, 44100);
  const hop = Math.round(0.01 * rate);
  const length = Math.round(0.04 * rate);
  const rows = [];
  for (let frame = 10; frame <= 22; frame += 3) {
    const start = frame * hop;
    const { f0 } = yinPitch(samples, start, length, rate);
    const slope =
      (yinPitch(samples, start + hop, length, rate).f0 -
        yinPitch(samples, start - hop, length, rate).f0) /
      0.02;
    const straight = straighten(samples, start, 700, rate, slope, f0);
    const integer = yinPitch(straight, 0, length, rate).aperiodicity;
    rows.push(
      `t ${(start / rate).toFixed(2)} s f0 ${f0.toFixed(1)} slope ${slope.toFixed(0)}: integer lag ${decibels(integer)} dB, fractional lag ${decibels(fractional(straight, length, rate / f0))} dB`
    );
  }
  console.log(`breathiness ${breathiness}\n  ${rows.join('\n  ')}`);
}
