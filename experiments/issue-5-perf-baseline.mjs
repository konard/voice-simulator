// Times every audio tier on a fixed utterance and fingerprints the output,
// so optimisations can be checked for producing the same waveform.
// Usage: node experiments/issue-5-perf-baseline.mjs [out.json] [baseline.json]
// With a baseline, exits with 1 when any tier's waveform hash differs.
// DURATION (seconds, default 0.4) and KERNEL ('wasm' or 'js') are optional.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  AUDIO_TIERS,
  DEFAULT_HEAD,
  buildVoxelModel,
  planUtterance,
  renderPlan,
} from '../src/index.js';

const plan = planUtterance('ˈhæloʊ ˈsiːz', { head: DEFAULT_HEAD });
const seconds = Number(process.env.DURATION ?? 0.4);
const short = { ...plan, duration: seconds };
const results = [];
for (const tier of AUDIO_TIERS) {
  let began = globalThis.performance.now();
  const model =
    tier.solver === 'fdtd3d'
      ? buildVoxelModel(DEFAULT_HEAD, { dx: tier.dx })
      : null;
  const modelSeconds = (globalThis.performance.now() - began) / 1000;
  began = globalThis.performance.now();
  const samples = renderPlan(short, {
    ...tier,
    head: DEFAULT_HEAD,
    model,
    kernel: process.env.KERNEL,
  });
  const renderSeconds = (globalThis.performance.now() - began) / 1000;
  const hash = createHash('sha256')
    .update(Buffer.from(samples.buffer))
    .digest('hex')
    .slice(0, 16);
  const row = {
    tier: tier.name,
    modelSeconds: +modelSeconds.toFixed(3),
    renderSeconds: +renderSeconds.toFixed(3),
    load: +(renderSeconds / seconds).toFixed(3),
    hash,
  };
  console.log(row.tier, row.modelSeconds, row.renderSeconds, row.load, hash);
  results.push(row);
}
if (process.argv[2]) {
  writeFileSync(process.argv[2], JSON.stringify(results));
}
if (process.argv[3]) {
  const baseline = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let same = true;
  for (const row of results) {
    const before = baseline.find((entry) => entry.tier === row.tier);
    const match = before?.hash === row.hash;
    same &&= match;
    const speedup = before ? before.renderSeconds / row.renderSeconds : NaN;
    console.log(
      row.tier,
      match ? 'same waveform' : 'DIFFERENT',
      `${speedup.toFixed(2)}x`
    );
  }
  process.exitCode = same ? 0 : 1;
}
