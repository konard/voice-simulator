// Inter-incisor gap of the model for the phonemes G-OBIM (Calka et al.
// 2025, PLOS Comput Biol 21(9): e1013378, Table 3) reports mandibular
// openings for. The paper gives no reference for its openings, so the
// differences from /i/ are what the model is compared on.
// Usage: node experiments/jaw-opening.mjs
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { teethGap } from '../src/articulation/teeth.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD, presetHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const vowel = (symbol) => ({
  ...vowelTarget({ phoneme: getPhoneme(symbol) }),
  rhotic: 0,
});
function consonant(text) {
  const plan = planUtterance(text);
  const segment = plan.segments.find((entry) => entry.kind === 'consonant');
  return sampleState(plan, (segment.start + segment.end) / 2);
}

const GOBIM = {
  a: [11, vowel('a')],
  u: [7, vowel('u')],
  i: [3, vowel('i')],
  t: [1, consonant('ˈata')],
  k: [5, consonant('ˈaka')],
  'k (i)': [5, consonant('ˈiki')],
  'k (u)': [5, consonant('ˈuku')],
  't (i)': [1, consonant('ˈiti')],
};
for (const preset of ['default', 'male', 'female', 'child']) {
  const head = preset === 'default' ? DEFAULT_HEAD : presetHeadConfig(preset);
  const base = teethGap(GOBIM.i[1], head);
  const row = Object.entries(GOBIM).map(([name, [mm, state]]) => {
    const gap = teethGap(state, head);
    return `${name} ${(gap * 10).toFixed(1)} Δi ${((gap - base) * 10).toFixed(1)} (G-OBIM ${mm - 3})`;
  });
  console.log(preset, `jawRange ${head.jawRange.toFixed(2)}:`, row.join(', '));
}
