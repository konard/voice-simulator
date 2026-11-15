// Can any LOSS_SHAPE / RADIATION_BAFFLE / LOSS_STAGES bring the closed-glottis
// B1-B3 of the planned [ɑ], [i] and [u] (section 6 of
// experiments/issue-11-audit-m2.mjs) within 35 % of Hawks & Miller?
// Prints the worst relative error for each setting.
// Run: node experiments/issue-36-audit-scan.mjs
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import {
  planUtterance,
  normalizeHeadConfig,
  Waveguide,
  sampleState,
  tractShape,
  noseShape,
} from '../src/index.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { publishedBandwidth } from '../src/acoustics/losses.js';

const head = normalizeHeadConfig({});
const noseSections = Math.max(
  6,
  Math.round((44 * noseShape(head).length) / head.vocalTractLength)
);
const shapes = ['ɑ', 'i', 'u'].map((ipa) => {
  const plan = planUtterance(ipa, { head });
  const segment = plan.segments.find((item) => item.kind === 'vowel');
  const state = sampleState(plan, (segment.start + segment.end) / 2, {});
  return [ipa, tractShape(state, head, { sections: 44, teeth: true })];
});
function errors(options) {
  return shapes
    .map(([ipa, shape]) => {
      const solver = new Waveguide({
        sections: 44,
        noseSections,
        head,
        ...options,
      });
      solver.setNose(noseShape(head).areas);
      solver.setShape(shape.areas, 0, shape.velumIndex);
      solver.setLength(shape.length);
      solver.glottalReflection = 1;
      const rate = (44 * SPEED_OF_SOUND) / shape.length;
      const response = new Float64Array(Math.round(0.25 * rate));
      for (let i = 0; i < response.length; i++) {
        response[i] = solver.step(i === 0 ? 1 : 0, 0, 0);
      }
      const peaks = resonances(
        impulseSpectrum(response, rate, { from: 150, to: 3600, step: 4 }),
        { count: 3 }
      );
      return `[${ipa}] ${peaks
        .map(({ frequency: f, bandwidth: b }) =>
          `${(100 * (b / publishedBandwidth(f) - 1)).toFixed(0)}`.padStart(4)
        )
        .join('')}`;
    })
    .join('  ');
}
for (const lossShape of [1, 1.2, 2, 3]) {
  for (const baffle of [0.3, 1]) {
    for (const lossStages of [2, 5]) {
      console.log(
        `shape ${lossShape} baffle ${baffle} stages ${lossStages}: B1-B3 error % ${errors({ lossShape, baffle, lossStages })}`
      );
    }
  }
}
