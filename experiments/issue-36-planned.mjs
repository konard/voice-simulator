// Bandwidths of the planned vowel shapes (as in section 6 of
// experiments/issue-11-audit-m2.mjs, closed glottis) with parts of the loss
// model switched off, to find what widens a formant.
// Run: node experiments/issue-36-planned.mjs ɑ
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import {
  planUtterance,
  normalizeHeadConfig,
  Waveguide,
  sampleState,
  tractShape,
  noseShape,
} from '../src/index.js';
import { SPEED_OF_SOUND, tubeSpectrum } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { publishedBandwidth } from '../src/acoustics/losses.js';

const nose = (head) =>
  Math.max(
    6,
    Math.round((44 * noseShape(head).length) / head.vocalTractLength)
  );
const head = normalizeHeadConfig({});
for (const ipa of process.argv.slice(2)) {
  const plan = planUtterance(ipa, { head });
  const segment = plan.segments.find((item) => item.kind === 'vowel');
  const state = sampleState(plan, (segment.start + segment.end) / 2, {});
  const shape = tractShape(state, head, { sections: 44, teeth: true });
  console.log(
    `[${ipa}] length ${shape.length.toFixed(2)} velum ${shape.velum?.toFixed?.(3) ?? shape.velum} areas ${Array.from(shape.areas, (a) => a.toFixed(2)).join(' ')}`
  );
  const variants = {
    default: {},
    'no walls': { walls: false },
    'no piriform': { piriform: false },
    'no walls, no piriform': { walls: false, piriform: false },
    'radiation only': { walls: false, piriform: false, lossShape: 1e-9 },
    'radiation, baffle 0': {
      walls: false,
      piriform: false,
      lossShape: 1e-9,
      baffle: 0,
    },
  };
  for (const [label, options] of Object.entries(variants)) {
    const solver = new Waveguide({
      sections: 44,
      noseSections: nose(head),
      head,
      ...options,
    });
    solver.setNose(noseShape(head).areas);
    solver.setShape(
      shape.areas,
      process.env.VELUM ? Number(process.env.VELUM) : 0,
      shape.velumIndex,
      shape.teeth
    );
    solver.setLength(shape.length);
    solver.glottalReflection = 1;
    const rate = (44 * SPEED_OF_SOUND) / shape.length;
    const response = new Float64Array(Math.round(0.25 * rate));
    for (let i = 0; i < response.length; i++)
      response[i] = solver.step(i === 0 ? 1 : 0, 0, 0);
    const peaks = resonances(
      impulseSpectrum(response, rate, { from: 100, to: 3600, step: 2 }),
      { count: 3 }
    );
    console.log(
      `  ${label.padEnd(22)} ${peaks.map(({ frequency: f, bandwidth: b }) => `${f.toFixed(0)}/${b.toFixed(0)} (HM ${publishedBandwidth(f).toFixed(0)})`).join('  ')}`
    );
  }
  const spectrum = tubeSpectrum(shape.areas, shape.length, {
    head,
    step: 2,
    maxFrequency: 3600,
    branches: [piriformBranch(44, shape.length, head)],
  });
  console.log(
    `  ${'tube'.padEnd(22)} ${resonances(spectrum, { count: 3 })
      .map(
        ({ frequency: f, bandwidth: b }) => `${f.toFixed(0)}/${b.toFixed(0)}`
      )
      .join('  ')}`
  );
}
