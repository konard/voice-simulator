// Issue 170: does the live recognizer hear words in noise with no speech?
// Realistic room noise is not stationary: its level drifts and it has bumps.
import { createRecognizer } from '../../src/index.js';

const rate = 48000;
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}
function pink(n, seed) {
  const r = rng(seed);
  const out = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.1;
  }
  return out;
}
function modulated(seconds, seed, lowDb, highDb, step) {
  const n = seconds * rate;
  const x = pink(n, seed);
  const r = rng(seed + 7);
  const out = new Float32Array(n);
  let g = 0,
    target = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(step * rate) === 0) {
      target = 10 ** ((lowDb + ((r() + 1) / 2) * (highDb - lowDb)) / 20);
    }
    g += (target - g) * 0.0005;
    out[i] = x[i] * g;
  }
  return out;
}
function run(name, samples) {
  const rec = createRecognizer({ sampleRate: rate, languages: ['en'] });
  let error = null;
  rec.on('error', (e) => (error = e));
  for (let i = 0; i < samples.length; i += 128) {
    rec.push(samples.slice(i, i + 128));
  }
  let out;
  try {
    out = error ? `error ${error.code}` : JSON.stringify(rec.flush().text);
  } catch (e) {
    out = `flush error ${e.code}`;
  }
  console.log(`${name}: ${out}`);
}
run('pink drifting -60..-40 dBFS, 0.3 s steps', modulated(5, 3, -60, -40, 0.3));
run('pink drifting -50..-45 dBFS, 0.5 s steps', modulated(5, 4, -50, -45, 0.5));
run('pink drifting -70..-30 dBFS, 0.2 s steps', modulated(5, 5, -70, -30, 0.2));
