// Quick measurement of the phonation types of issue 54 on "Please call Stella."
// node experiments/issue-54-quick.mjs [engine]
import { performance } from 'node:perf_hooks';
import { synthesize, analyzeVoice } from '../src/index.js';
const TEXT = 'Please call Stella.';
const engine = process.argv[2];
const BASE = {
  tier: 'medium',
  seed: 1,
  markup: true,
  ...(engine ? { engine } : {}),
};
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
for (const [name, text] of rows) {
  const t = performance.now();
  const r = synthesize(text, BASE);
  const v = analyzeVoice(r.samples, r.sampleRate);
  modal ??= v;
  console.log(
    name.padEnd(9),
    'f0',
    v.f0?.toFixed(1),
    'st',
    semi(v.f0, modal.f0).toFixed(2),
    'h1h2',
    v.h1h2?.toFixed(2),
    'hnr',
    v.hnr?.toFixed(2),
    `${((performance.now() - t) / 1000).toFixed(1)}s`
  );
}
