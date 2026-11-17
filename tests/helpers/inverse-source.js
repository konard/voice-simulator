/** Known LF source through three all-pole formants (issue 61, Unlicense). */
import { Glottis } from '../../src/acoustics/glottis.js';
import { createRandom } from '../../src/random.js';

export function sourceVowel(tenseness = 0.5, f0 = 110, rate = 16000) {
  const glottis = new Glottis({
    seed: 1,
    tenseness,
    breathiness: 0,
    jitter: 0,
    shimmer: 0,
  });
  const control = { f0, voicing: 1, aspiration: 0, closure: 0, loudness: 1 };
  const truth = Float32Array.from({ length: Math.round(1.5 * rate) }, () =>
    glottis.step(1 / rate, control, 0)
  );
  let signal = Float64Array.from(truth);
  for (const [frequency, bandwidth] of [
    [500, 60],
    [1500, 90],
    [2500, 120],
  ]) {
    const r = Math.exp((-Math.PI * bandwidth) / rate);
    const a1 = -2 * r * Math.cos((2 * Math.PI * frequency) / rate);
    const a2 = r * r;
    const y = new Float64Array(signal.length);
    for (let n = 0; n < y.length; n++) {
      y[n] = signal[n] - a1 * (y[n - 1] ?? 0) - a2 * (y[n - 2] ?? 0);
    }
    signal = y;
  }
  const scale = 0.8 / Math.max(...signal.map(Math.abs));
  return {
    truth,
    samples: Float32Array.from(signal, (x) => x * scale),
    rate,
    f0,
  };
}
export function addNoise(samples, db, seed = 'inverse-noise') {
  const random = createRandom(seed);
  const power = samples.reduce((sum, v) => sum + v * v, 0) / samples.length;
  const gain = Math.sqrt(3 * power) * 10 ** (db / 20);
  return Float32Array.from(samples, (v) => v + gain * (2 * random() - 1));
}
export function median(x) {
  const values = Array.from(x)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
export function correlation(actual, truth, rate) {
  let best = -1;
  let shift = 0;
  for (
    let lag = -Math.round(0.002 * rate);
    lag <= Math.round(0.002 * rate);
    lag++
  ) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let n = Math.round(0.1 * rate); n < truth.length - 0.1 * rate; n++) {
      xy += actual[n + lag] * truth[n];
      xx += actual[n + lag] ** 2;
      yy += truth[n] ** 2;
    }
    const r = xy / Math.sqrt(xx * yy);
    if (r > best) {
      best = r;
      shift = lag;
    }
  }
  return { correlation: best, shift };
}
