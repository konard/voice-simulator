// White noise through resonators 500/1500/2500 Hz (bandwidths 60/90/120 Hz)
// at 16 kHz, as in the test `finds the roots of a known filter`: median
// F1 .. F3 and bandwidths of trackFormants for a few frontend settings.
// Run: node experiments/issue-60-resonators.mjs > experiments/issue-60-resonators.txt
//      node experiments/issue-60-resonators.mjs tilt >> experiments/issue-60-resonators.txt
// (`tilt`: the noise goes through 1 / (1 - 0.97 z^-1) first.)
import { analyzeFrames, trackFormants } from '../src/index.js';
import { createRandom, randomNormal } from '../src/random.js';

const rate = 16000;
const random = createRandom('formants:resonators');
const tilt = process.argv[2] === 'tilt';
let signal = Float64Array.from({ length: 2 * rate }, () =>
  randomNormal(random)
);
if (tilt) {
  // Source with the -6 dB/octave tilt that the 0.97 pre-emphasis of the
  // frontend removes: the LPC then sees the all-pole cascade alone.
  for (let n = 1; n < signal.length; n++) {
    signal[n] += 0.97 * signal[n - 1];
  }
}
const truth = [
  [500, 60],
  [1500, 90],
  [2500, 120],
];
for (const [frequency, bandwidth] of truth) {
  const radius = Math.exp((-Math.PI * bandwidth) / rate);
  const a1 = 2 * radius * Math.cos((2 * Math.PI * frequency) / rate);
  const a2 = -radius * radius;
  const out = new Float64Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    out[n] =
      (1 - radius) * signal[n] +
      a1 * (n > 0 ? out[n - 1] : 0) +
      a2 * (n > 1 ? out[n - 2] : 0);
  }
  signal = out;
}
let peak = 0;
for (const value of signal) {
  peak = Math.max(peak, Math.abs(value));
}
const samples = Float32Array.from(signal, (value) => (0.5 * value) / peak);
const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
for (const options of [
  {},
  { preEmphasis: 0 },
  { window: 0.05 },
  { lpc: 'autocorrelation' },
  { lpc: 'covariance' },
]) {
  const track = trackFormants(analyzeFrames(samples, rate, options));
  const result = truth.map((_, k) => {
    const f = [];
    const b = [];
    for (let t = 10; t < track.count - 10; t++) {
      if (track.valid[t * 4 + k]) {
        f.push(track.frequency[t * 4 + k]);
        b.push(track.bandwidth[t * 4 + k]);
      }
    }
    return `F${k + 1} ${median(f).toFixed(1)} / ${median(b).toFixed(1)}`;
  });
  console.log(
    tilt ? 'tilt' : 'white',
    JSON.stringify(options),
    result.join(', ')
  );
}
