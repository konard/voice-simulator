// Phonation measures (issue 54) of each type on "Please call Stella."
// node experiments/issue-54-measures.mjs
import { synthesize, analyzeVoice } from '../src/index.js';
import {
  cpp,
  jitterPercent,
  pulseF0,
  pulseH1H2,
} from '../src/analysis/mode-features.js';
const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1, markup: true };
const semi = (a, b) => 12 * Math.log2(a / b);
const rows = [['modal', TEXT]];
for (const name of [
  'breathy',
  'lax',
  'pressed',
  'creaky',
  'falsetto',
  'harsh',
]) {
  rows.push([
    name,
    `<speak><vs:phonation name="${name}" degree="1">${TEXT}</vs:phonation></speak>`,
  ]);
}
let modal;
const f = (x) => x.toFixed(2);
for (const [name, text] of rows) {
  const r = synthesize(text, BASE);
  const v = analyzeVoice(r.samples, r.sampleRate);
  const m = {
    ...v,
    cpp: cpp(r.samples, r.sampleRate),
    jitter: jitterPercent(r.samples, r.sampleRate),
    pulse: pulseF0(r.samples, r.sampleRate),
    ph: pulseH1H2(r.samples, r.sampleRate),
  };
  modal ??= m;
  console.log(
    `${name.padEnd(9)} f0 ${f(v.f0)} (${f(semi(v.f0, modal.f0))} st) pulseF0 ${f(m.pulse)} (${f(semi(m.pulse, modal.pulse))} st) h1h2 ${f(v.h1h2)} pulseH1H2 ${f(m.ph)} hnr ${f(v.hnr)} cpp ${f(m.cpp)} jitter ${f(m.jitter)} %`
  );
}
