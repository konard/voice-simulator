// Scale of melCepstralDistortion against a known spectral difference
// (issue 150). The same white noise is compared with itself after a gentle
// spectral tilt of +/- A dB across 0..8 kHz. Conventional mel-cepstral
// distortion (Kubichek 1993, SPTK-style cepstrum of the log amplitude)
// equals half the RMS of the mean-removed dB difference, about A / 3.46 for a
// straight line; this function scores the same tilt about 14 times higher.
import { melCepstralDistortion } from '../src/index.js';
const sr = 16000,
  n = sr * 2;
let seed = 1;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
const x = Float64Array.from({ length: n }, rand);
for (const A of [3, 6, 12]) {
  // linear-in-frequency tilt of total span 2A dB, built in the DFT domain on 4096-sample blocks
  const y = new Float64Array(n);
  // Apply the tilt in the frequency domain with the library FFT.
  const { fft } = await import('../src/metrics/spectrum.js');
  const size = 1 << Math.ceil(Math.log2(n));
  const R = new Float64Array(size),
    I = new Float64Array(size);
  R.set(x);
  fft(R, I);
  for (let k = 0; k < size; k++) {
    const f = (Math.min(k, size - k) / size) * sr; // 0..8000
    const g = 10 ** ((A * ((2 * f) / 8000 - 1)) / 20);
    R[k] *= g;
    I[k] *= g;
  }
  // inverse via conj trick
  for (let k = 0; k < size; k++) {
    I[k] = -I[k];
  }
  fft(R, I);
  for (let t = 0; t < n; t++) {
    y[t] = R[t] / size;
  }
  const rmsDb = A / Math.sqrt(3); // RMS of a line from -A to +A
  const mcd = melCepstralDistortion(x, y, sr);
  console.log(
    `tilt +/-${A} dB: RMS difference ${rmsDb.toFixed(2)} dB, conventional MCD ${(rmsDb / 2).toFixed(2)} dB, melCepstralDistortion ${mcd.toFixed(2)} dB, ratio ${(mcd / (rmsDb / 2)).toFixed(1)}`
  );
}
