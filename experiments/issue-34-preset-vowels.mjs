/**
 * Checklist item c of issue 34: the vowel tests of tests/head-presets.test.js
 * ('makes the female preset sound female' and 'gives the female and child
 * presets the spectral tilt of women') on tier medium (the waveguide, the
 * default of renderPlan) with the LF source, the fold source and the fold
 * source with the source-tract interaction. Prints the measured values and
 * whether each bound of the tests holds.
 *
 *   node experiments/issue-34-preset-vowels.mjs
 */
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import {
  estimateFormants,
  estimatePitch,
  spectralTilt,
} from '../src/acoustics/analysis.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { presetHeadConfig, randomHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const SETUPS = {
  lf: { source: 'lf' },
  folds: { source: 'folds' },
  interaction: { source: 'folds', interaction: true },
};

function render(head, vowel, options) {
  const plan = planUtterance(`ˈ${vowel}ː`, { head });
  const samples = renderPlan(plan, { sampleRate: RATE, ...options });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  return { samples, middle: (segment.start + segment.end) / 2 };
}

// As measure() in tests/head-presets.test.js.
function measure(head, vowel, options) {
  const { samples, middle } = render(head, vowel, options);
  const range = { start: middle - 0.03, duration: 0.06 };
  return {
    f0: estimatePitch(samples, RATE, range),
    formants: estimateFormants(samples, RATE, {
      ...range,
      count: 3,
      order: 14,
    }),
  };
}

// As tilt() in tests/head-presets.test.js.
function tilt(preset, options) {
  const head = presetHeadConfig(preset);
  const sums = { h1h2Corrected: 0, h1a3Corrected: 0 };
  for (const vowel of ['æ', 'ɑ', 'ʌ']) {
    const { samples, middle } = render(head, vowel, options);
    const range = { start: middle - 0.04, duration: 0.08 };
    const f0 = estimatePitch(samples, RATE, { ...range, min: 70 });
    const measures = spectralTilt(samples, RATE, {
      ...range,
      f0,
      formants: HILLENBRAND[preset][vowel],
    });
    for (const key of Object.keys(sums)) {
      sums[key] += measures[key] / 3;
    }
  }
  return sums;
}

const within = (value, low, high) =>
  `${value.toFixed(3)} ${value > low && value < high ? 'ok' : `FAILS (${low}..${high})`}`;

for (const [name, options] of Object.entries(SETUPS)) {
  console.log(`== ${name}`);
  const female = presetHeadConfig('female');
  const male = presetHeadConfig('male');
  for (const vowel of ['i', 'ə']) {
    const high = measure(female, vowel, options);
    const low = measure(male, vowel, options);
    console.log(
      `  [${vowel}] female f0 ${within(high.f0, 180, 260)}, male f0 ${within(low.f0, 95, 150)}, ` +
        `F2 female/male ${within(high.formants[1] / low.formants[1], 1.1, 1.35)}`
    );
  }
  for (const seed of [1, 2, 3]) {
    const voice = measure(
      randomHeadConfig(seed, { preset: 'female' }),
      'ə',
      options
    );
    console.log(
      `  random female ${seed} [ə] f0 ${within(voice.f0, 165, Infinity)}`
    );
  }
  const reference = tilt('male', options);
  for (const preset of ['female', 'child']) {
    const voice = tilt(preset, options);
    const h1h2 = voice.h1h2Corrected - reference.h1h2Corrected;
    const h1a3 = voice.h1a3Corrected - reference.h1a3Corrected;
    console.log(
      `  ${preset} - male: H1*-H2* ${within(h1h2, 2, 7)} dB, H1*-A3* ${within(h1a3, 5.5, 14)} dB`
    );
  }
}
