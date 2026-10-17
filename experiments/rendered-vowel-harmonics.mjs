// Harmonic amplitudes (dB) of a rendered /aː/ for a head seed, per solver,
// to see where LPC finds its first formant.
// Usage: node experiments/rendered-vowel-harmonics.mjs [seed] [dx]
import {
  buildVoxelModel,
  estimatePitch,
  planUtterance,
  randomHeadConfig,
  renderPlan,
  sampleState,
} from '../src/index.js';

const seed = process.argv[2] ?? 'ci-8';
const dx = Number(process.argv[3] ?? 1);
const head = randomHeadConfig(seed);
const plan = planUtterance('ˈaː', { head });
const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
const middle = (vowel.start + vowel.end) / 2;
const state = sampleState(plan, middle);
console.log(
  'state',
  Object.fromEntries(
    Object.entries(state).map(([key, value]) => [key, +value.toFixed(3)])
  )
);
const rate = 24000;
for (const solver of ['waveguide', 'fdtd3d']) {
  const options = { sampleRate: rate, sections: 44, solver };
  if (solver === 'fdtd3d') {
    options.model = buildVoxelModel(head, { dx });
  }
  const samples = renderPlan(plan, options);
  const start = Math.round((middle - 0.05) * rate);
  const frame = samples.slice(start, start + Math.round(0.1 * rate));
  const f0 = estimatePitch(frame, rate);
  const rows = [];
  for (let k = 1; k * f0 < 3500; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k * f0) / rate;
    for (let n = 0; n < frame.length; n++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / frame.length);
      re += frame[n] * hann * Math.cos(w * n);
      im -= frame[n] * hann * Math.sin(w * n);
    }
    rows.push([Math.round(k * f0), Math.hypot(re, im)]);
  }
  const max = Math.max(...rows.map((row) => row[1]));
  console.log(
    solver,
    `f0 ${f0.toFixed(1)}`,
    rows
      .map(([f, m]) => `${f}:${(20 * Math.log10(m / max)).toFixed(0)}`)
      .join(' ')
  );
}
