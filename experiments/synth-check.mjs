// Synthesize a phrase with the 1D waveguide and write a WAV file.
// Usage: node experiments/synth-check.mjs "text" [out.wav] [sections]
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { encodeWav } from '../src/audio/wav.js';
import { textToIpa } from '../src/g2p/index.js';

const text = process.argv[2] ?? 'Hello world, how are you?';
const out = process.argv[3] ?? 'experiments/out/synth.wav';
const sections = Number(process.argv[4] ?? 44);
const { ipa, lang } = textToIpa(text);
const plan = planUtterance(ipa, { language: lang });
const start = performance.now();
const samples = renderPlan(plan, { sampleRate: 48000, sections });
const elapsed = (performance.now() - start) / 1000;
let peak = 0;
let energy = 0;
for (const s of samples) {
  peak = Math.max(peak, Math.abs(s));
  energy += s * s;
}
console.log(ipa, lang);
console.log(
  `duration ${plan.duration.toFixed(2)} s, render ${elapsed.toFixed(2)} s,` +
    ` realtime x${(plan.duration / elapsed).toFixed(1)}, peak ${peak.toFixed(3)},` +
    ` rms ${Math.sqrt(energy / samples.length).toFixed(4)}`
);
writeFileSync(out, encodeWav(samples, 48000));
