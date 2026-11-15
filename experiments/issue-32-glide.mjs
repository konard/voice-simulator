// Issue 32: the HNR measure of noise-free harmonic signals whose pitch
// glides (sum of 10 harmonics of amplitude 1/k), and of steady ones.
// A noise-free signal should read close to the 30 dB ceiling.
// Run: node experiments/issue-32-glide.mjs
import { analyzeVoice } from '../src/analysis/voice-features.js';

function glide(from, to, seconds, sampleRate, harmonics = 10) {
  const samples = new Float64Array(Math.round(seconds * sampleRate));
  let phase = 0;
  for (let index = 0; index < samples.length; index++) {
    const f0 = from + ((to - from) * index) / samples.length;
    phase += (2 * Math.PI * f0) / sampleRate;
    let sum = 0;
    for (let k = 1; k <= harmonics; k++) {
      sum += Math.sin(k * phase) / k;
    }
    samples[index] = 0.2 * sum;
  }
  return samples;
}

for (const [from, to, seconds, rate] of [
  [150, 100, 0.5, 16000],
  [100, 150, 0.5, 16000],
  [126, 114, 1, 48000],
  [120, 120, 1, 16000],
  [250, 180, 0.5, 16000],
]) {
  const features = analyzeVoice(glide(from, to, seconds, rate), rate);
  console.log(
    `${from} to ${to} Hz in ${seconds} s at ${rate} Hz: hnr ${features.hnr.toFixed(2)} dB, f0 ${features.f0.toFixed(1)} Hz`
  );
}
