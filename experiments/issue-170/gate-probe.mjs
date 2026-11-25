// Issue 170: voiced time and whisper spans of noise-only inputs against speech,
// to pick the speech gate of the recognizer.
import { recognize, synthesize } from '../../src/index.js';
import { resample } from '../../src/audio/resample.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { findWhisper } from '../../src/recognition/whisper.js';

const rate = 16000;
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}
function pinkDrift(seconds, seed, lowDb, highDb, step) {
  const n = seconds * rate;
  const r = rng(seed);
  const out = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    g = 0,
    target = 0;
  for (let i = 0; i < n; i++) {
    const w = r();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    if (i % Math.round(step * rate) === 0) {
      target = 10 ** ((lowDb + ((r() + 1) / 2) * (highDb - lowDb)) / 20);
    }
    g += (target - g) * 0.002;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.1 * g;
  }
  return out;
}
function probe(name, x) {
  const a = analyzeFrames(x, rate, { hop: 0.01 });
  const pitch = trackPitch(a);
  let speech = 0,
    periodic = 0,
    voiced = 0;
  for (let t = 0; t < a.count; t++) {
    speech += a.speech[t];
    if (a.speech[t] && a.periodicity[t] >= 0.6) {
      periodic++;
    }
  }
  for (let t = 0; t < pitch.count; t++) {
    if (pitch.voiced?.[t] || pitch.f0?.[t] > 0) {
      voiced++;
    }
  }
  const w = findWhisper(x, rate, a, pitch);
  let text;
  try {
    text = recognize(x, rate, { languages: ['en'] }).text;
  } catch (e) {
    text = e.code;
  }
  console.log(
    `${name}: speech ${(speech * a.hop).toFixed(2)} s, speech&periodic ${(periodic * a.hop).toFixed(2)} s, pitch voiced ${(voiced * pitch.hop).toFixed(2)} s, whisper ${JSON.stringify(w.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]))} -> ${JSON.stringify(text)}`
  );
}
for (const [i, [lo, hi, st]] of [
  [-60, -40, 0.3],
  [-50, -45, 0.5],
  [-70, -30, 0.2],
].entries()) {
  probe(`pink ${lo}..${hi}`, pinkDrift(5, 3 + i, lo, hi, st));
}
for (const [text, opts] of [
  ['Hello hello hello.', {}],
  ['Hello hello hello.', { preset: 'female' }],
  ['[whisper]Hello, how are you?[/whisper]', { markup: true }],
]) {
  const s = synthesize(text, {
    lang: 'en',
    tier: 'telephone',
    seed: 1,
    ...opts,
  });
  probe(text + JSON.stringify(opts), resample(s.samples, s.sampleRate, rate));
}
