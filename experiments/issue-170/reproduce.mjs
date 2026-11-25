// Issue 170: the app's microphone path (createRecognizer, streaming) against
// batch recognize() on the same synthetic "Hello hello ..." with and without
// noise, and on noise alone. Usage: node experiments/issue-170/reproduce.mjs
import { createRecognizer, recognize, synthesize } from '../../src/index.js';
import { resample } from '../../src/audio/resample.js';

const tier = process.env.TIER ?? 'telephone';
const rate = 48000; // an iPhone microphone runs the AudioContext at 48 kHz
const text = process.env.TEXT ?? 'Hello hello hello hello hello.';
const t0 = globalThis.performance.now();
const spoken = synthesize(text, { lang: 'en', tier, seed: 1 });
console.log(
  `synth ${tier} ${spoken.sampleRate} Hz ${spoken.duration.toFixed(2)} s in ${((globalThis.performance.now() - t0) / 1000).toFixed(1)} s`
);
const clean = resample(spoken.samples, spoken.sampleRate, rate);

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}
function rms(x) {
  let e = 0;
  for (const v of x) {
    e += v * v;
  }
  return Math.sqrt(e / x.length);
}
function white(n, level, seed = 1) {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = r();
  }
  const k = level / rms(out);
  for (let i = 0; i < n; i++) {
    out[i] *= k;
  }
  return out;
}
function withPadding(x, seconds) {
  const pad = Math.round(seconds * rate);
  const out = new Float32Array(x.length + 2 * pad);
  out.set(x, pad);
  return out;
}

function stream(samples) {
  const rec = createRecognizer({ sampleRate: rate, languages: ['en'] });
  const finals = [];
  rec.on('final', ({ text }) => finals.push(text));
  let error = null;
  rec.on('error', (e) => (error = e));
  for (let i = 0; i < samples.length; i += 128) {
    rec.push(samples.slice(i, i + 128));
    if (error) {
      break;
    }
  }
  if (error) {
    return `error ${error.code ?? error.message}`;
  }
  try {
    return `${JSON.stringify(rec.flush().text)} finals=${JSON.stringify(finals)}`;
  } catch (e) {
    return `flush error ${e.code ?? e.message}`;
  }
}
function batch(samples) {
  try {
    return JSON.stringify(recognize(samples, rate, { languages: ['en'] }).text);
  } catch (e) {
    return `error ${e.code ?? e.message}`;
  }
}

const speech = withPadding(clean, 0.5);
const speechRms = rms(clean);
const cases = [['clean', speech]];
for (const snr of [20, 10]) {
  const noise = white(speech.length, speechRms / 10 ** (snr / 20));
  cases.push([`white ${snr} dB`, speech.map((v, i) => v + noise[i])]);
}
cases.push(['white noise only (-50 dBFS)', white(3 * rate, 10 ** (-50 / 20))]);
cases.push(['white noise only (-30 dBFS)', white(3 * rate, 10 ** (-30 / 20))]);
const only = process.env.ONLY;
for (const [name, samples] of cases) {
  if (only && !name.includes(only)) {
    continue;
  }
  let t = globalThis.performance.now();
  const s = stream(samples);
  const ts = (globalThis.performance.now() - t) / 1000;
  t = globalThis.performance.now();
  const b = process.env.NOBATCH ? '-' : batch(samples);
  const tb = (globalThis.performance.now() - t) / 1000;
  console.log(
    `${name}\n  stream (${ts.toFixed(1)} s): ${s}\n  batch  (${tb.toFixed(1)} s): ${b}`
  );
}
