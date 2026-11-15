/**
 * Issue 40: what each free articulator does to the formants of the
 * waveguide (impulse response, closed glottis, 44 sections), the numbers
 * tests/articulators.test.js holds. Usage:
 * node experiments/issue-40-articulators.mjs [jawArea]
 */
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { teethGap } from '../src/articulation/teeth.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { normalizeHeadConfig } from '../src/head-config.js';

/** First four formants (Hz) of a tract shape in the waveguide. */
export function waveguideFormants(shape) {
  const sections = shape.areas.length;
  const solver = new Waveguide({ sections });
  solver.setShape(shape.areas, 0, shape.velumIndex);
  solver.setLength(shape.length);
  const rate = (sections * SPEED_OF_SOUND) / shape.length;
  const response = new Float64Array(Math.round(0.06 * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  const peaks = spectralPeaks(response, rate, {
    from: 150,
    to: 5000,
    step: 2,
    prominence: 1,
  });
  return peaks.slice(0, 4);
}

const vowel = (symbol) => {
  const [height, backness, rounding] = STORY_FEATURES[symbol] ?? [0.5, 0.5, 0];
  return { height, backness, rounding, rhotic: 0 };
};
const head = normalizeHeadConfig({});
const change = (before, after) =>
  after
    .map(
      (value, index) => `${((100 * value) / before[index] - 100).toFixed(1)} %`
    )
    .join('  ');

function report(label, state, changed, changedHead = head) {
  const before = tractShape(state, head);
  const after = tractShape({ ...state, ...changed }, changedHead);
  const a = waveguideFormants(before);
  const b = waveguideFormants(after);
  console.log(
    label.padEnd(34),
    a.map(Math.round).join(' '),
    '->',
    b.map(Math.round).join(' '),
    `(${change(a, b)})`,
    `length ${before.length.toFixed(2)} -> ${after.length.toFixed(2)}`,
    `velum from lips ${(before.length * (1 - (before.velumIndex + 0.5) / 44)).toFixed(2)} -> ${(after.length * (1 - (after.velumIndex + 0.5) / 44)).toFixed(2)}`
  );
}

const e = vowel('ɛ');
report('jaw +0.5 cm on [ɛ]', e, { jaw: teethGap(e, head) + 0.5 });
report(
  'jawPosture +0.5 cm on [ɛ]',
  e,
  {},
  normalizeHeadConfig({ jawPosture: 0.5 })
);
report('larynxHeight -1 cm on [ɑ]', vowel('ɑ'), { larynxHeight: -1 });
report('larynxHeight +1 cm on [ɑ]', vowel('ɑ'), { larynxHeight: 1 });
report('lipProtrusion +0.6 cm on [i]', vowel('i'), { lipProtrusion: 0.6 });
report(
  'lipPosture -0.3 cm on [i]',
  vowel('i'),
  {},
  normalizeHeadConfig({ lipPosture: -0.3 })
);
report('tongueRoot -1 on [ə]', vowel('ə'), { tongueRoot: -1 });
report('tongueRoot +1 on [ə]', vowel('ə'), { tongueRoot: 1 });
// Lindblom & Sundberg (1971) move each articulator of their model alone:
// a lower larynx lowers all formants, lip protrusion mostly F2 and F3 of
// front vowels, a more open jaw raises F1.
report('larynxHeight -1 cm on [i]', vowel('i'), { larynxHeight: -1 });
report('larynxHeight -1 cm on [u]', vowel('u'), { larynxHeight: -1 });
report('lipProtrusion +0.6 cm on [ɑ]', vowel('ɑ'), { lipProtrusion: 0.6 });
report('jaw +0.5 cm on [ɑ]', vowel('ɑ'), {
  jaw: teethGap(vowel('ɑ'), head) + 0.5,
});
report('jaw +0.5 cm on [i]', vowel('i'), {
  jaw: teethGap(vowel('i'), head) + 0.5,
});
