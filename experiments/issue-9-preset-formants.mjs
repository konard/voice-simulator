// f0 and F1-F3 of the male, female and child presets for /i ɑ u/ in the
// waveguide and the 3D solver, next to Hillenbrand et al. (1995).
// Usage: node experiments/issue-9-preset-formants.mjs [dx=0.5] [vowels=iɑu]
import { performance } from 'node:perf_hooks';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const vowels = [...(process.argv[3] ?? 'iɑu')];
const HILLENBRAND = {
  male: {
    f0: 131,
    i: [342, 2322, 3000],
    ɑ: [768, 1333, 2522],
    u: [378, 997, 2343],
  },
  female: {
    f0: 220,
    i: [437, 2761, 3372],
    ɑ: [936, 1551, 2815],
    u: [459, 1105, 2735],
  },
  child: {
    f0: 237,
    i: [452, 3081, 3702],
    ɑ: [1002, 1688, 2950],
    u: [494, 1345, 2988],
  },
};

function measure(head, vowel, options) {
  const plan = planUtterance(`ˈ${vowel}ː`, { head });
  const rate = options.sampleRate;
  const samples = renderPlan(plan, options);
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = (segment.start + segment.end) / 2 - 0.03;
  return {
    f0: Math.round(estimatePitch(samples, rate, { start, duration: 0.06 })),
    formants: estimateFormants(samples, rate, {
      start,
      duration: 0.06,
      count: 3,
      order: 14,
      analysisRate: 16000,
    }).map(Math.round),
  };
}

const solvers = [
  ['waveguide', { solver: 'waveguide', sampleRate: 16000 }],
  [`3D dx ${dx}`, { solver: 'fdtd3d', dx, sampleRate: 48000 }],
];
for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  const target = HILLENBRAND[preset];
  console.log(
    `${preset}: VTL ${head.vocalTractLength} cm, pitch ${head.pitch} Hz (Hillenbrand f0 ${target.f0})`
  );
  for (const vowel of vowels) {
    const parts = [`  /${vowel}/ Hillenbrand ${target[vowel].join(' ')}`];
    for (const [name, options] of solvers) {
      const t0 = performance.now();
      const { f0, formants } = measure(head, vowel, options);
      parts.push(
        `${name}: f0 ${f0} F ${formants.join(' ')} (${((performance.now() - t0) / 1000).toFixed(1)} s)`
      );
    }
    console.log(parts.join(' | '));
  }
}
