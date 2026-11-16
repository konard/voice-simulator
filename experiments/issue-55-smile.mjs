// F1–F3 of the primary-stressed ˈa with and without an emotion, from the
// planned tract shape (tubeFormants), issue 55.
// node experiments/issue-55-smile.mjs [ipa] [emotion,…]
import { planUtterance } from '../src/articulation/plan.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { composeMode, createMode } from '../src/markup/modes.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const ipa = process.argv[2] ?? 'ˈpapa';
const formantsOf = (emotion) => {
  const modes = emotion
    ? [
        {
          from: 0,
          to: 1,
          mode: composeMode(createMode(), {
            emotion: { name: emotion, intensity: 1 },
          }),
        },
      ]
    : [];
  const plan = planUtterance(ipa, { head: DEFAULT_HEAD, modes });
  const vowel = plan.segments.find(
    (s) => s.kind === 'vowel' && s.token.stress === 1
  );
  const state = sampleState(plan, (vowel.start + vowel.end) / 2);
  const shape = tractShape(state, DEFAULT_HEAD);
  return { f: tubeFormants(shape.areas, shape.length, { count: 3 }), state };
};
const plain = formantsOf(null);
console.log(
  'plain',
  plain.f.map((x) => x.toFixed(0)).join(' '),
  'protrusion',
  plain.state.lipProtrusion?.toFixed(2),
  'round',
  plain.state.rounding?.toFixed(2)
);
for (const name of (process.argv[3] ?? 'happy,angry,bored,confident').split(
  ','
)) {
  const { f, state } = formantsOf(name);
  console.log(
    name.padEnd(10),
    f.map((x) => x.toFixed(0)).join(' '),
    'F2×',
    (f[1] / plain.f[1]).toFixed(3),
    'protrusion',
    state.lipProtrusion?.toFixed(2),
    'round',
    state.rounding?.toFixed(2)
  );
}
