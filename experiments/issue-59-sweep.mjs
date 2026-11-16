// Accuracy of trackPitch on a harmonic sweep 80 -> 500 Hz in 2 s (5
// harmonics, exponential glide), against the instantaneous f0.
// Run: node experiments/issue-59-sweep.mjs [rate]
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';

const rate = Number(process.argv[2] ?? 16000);
const seconds = 2;
const f0At = (time) => 80 * (500 / 80) ** (time / seconds);
const samples = new Float32Array(seconds * rate);
let phase = 0;
for (let n = 0; n < samples.length; n++) {
  let value = 0;
  for (let k = 1; k <= 5; k++) value += Math.sin(k * phase) / k;
  samples[n] = 0.3 * value;
  phase += (2 * Math.PI * f0At(n / rate)) / rate;
}
const frames = analyzeFrames(samples, rate);
const track = trackPitch(frames);
let worst = 0, sum = 0, n = 0, unvoiced = 0;
for (let t = 0; t < track.count; t++) {
  const time = t * frames.hop;
  if (time < 0.025 || time > seconds - 0.025) continue;
  if (track.f0[t] === 0) { unvoiced++; continue; }
  const error = Math.abs(track.f0[t] / f0At(time) - 1);
  worst = Math.max(worst, error);
  sum += Math.abs(1200 * Math.log2(track.f0[t] / f0At(time)));
  n++;
}
console.log({ frames: n, unvoiced, worstPercent: +(100 * worst).toFixed(3), meanCents: +(sum / n).toFixed(2) });
