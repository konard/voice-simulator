// Prints /a/ formants (LPC) and FDTD impulse peaks for random CI heads.
// Usage: node experiments/random-head-a-formants.mjs [seed...]
import {
  buildVoxelModel,
  estimateFormants,
  planUtterance,
  randomHeadConfig,
  renderPlan,
} from '../src/index.js';

const seeds = process.argv.slice(2);
for (const seed of seeds.length ? seeds : ['ci-0', 'ci-4', 'ci-8']) {
  const head = randomHeadConfig(seed);
  const plan = planUtterance('ˈaː', { head });
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const rate = 24000;
  for (const solver of ['waveguide', 'fdtd3d']) {
    const options = { sampleRate: rate, sections: 44, solver };
    if (solver === 'fdtd3d') {
      options.model = buildVoxelModel(head, { dx: 1 });
    }
    const samples = renderPlan(plan, options);
    const formants = estimateFormants(samples, rate, {
      start: middle - 0.03,
      duration: 0.06,
      count: 3,
    });
    console.log(seed, solver, formants.map(Math.round).join(' '));
  }
  console.log(
    seed,
    'head',
    JSON.stringify(head, (key, value) =>
      typeof value === 'number' ? Math.round(value * 100) / 100 : value
    )
  );
}
