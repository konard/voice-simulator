// Real-time factor of the 1D waveguide renderer on one core, measured for the
// rescoring budget of plan issue P55 (docs/case-studies/issue-11/plan).
// Usage: node experiments/issue-11-render-speed.mjs
import { performance } from 'node:perf_hooks';
import { renderPlan, synthesize } from '../src/index.js';

const text =
  'The north wind and the sun were disputing which was the stronger.';
for (const sampleRate of [16000, 8000]) {
  const options = { solver: 'waveguide', sampleRate, seed: 1 };
  const { plan, samples } = synthesize(text, { lang: 'en', ...options });
  const seconds = samples.length / sampleRate;
  const times = [];
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    renderPlan(plan, options);
    times.push((performance.now() - start) / 1000 / seconds);
  }
  const factors = times.map((value) => value.toFixed(3)).join(' ');
  console.log(
    `${sampleRate} Hz, ${seconds.toFixed(2)} s: renderPlan rtf ${factors}`
  );
}
