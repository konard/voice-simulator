/**
 * Print the articulator state in the middle of the first sound of short
 * utterances (the helper `rigOf()` of tests/visemes.test.js), to compare
 * the plan before and after issue 38: `node experiments/issue-38-rig-state.mjs [root]`.
 */
import { URL } from 'node:url';

const root = process.argv[2] ?? '..';
const base = new URL(`${root}/src/`, import.meta.url);
const { prepareUtterance } = await import(new URL('synthesize.js', base));
const { sampleState } = await import(
  new URL('articulation/tract-shape.js', base)
);
const { faceRig, arkitBlendshapes } = await import(new URL('index.js', base));

for (const ipa of process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['m', 'b', 'u']) {
  const { plan, head } = prepareUtterance(ipa, { ipa: true });
  const segment = plan.segments.find((entry) => entry.kind !== 'pause');
  const state = sampleState(plan, (segment.start + segment.end) / 2);
  const pick = ['lipAmount', 'lipArea', 'rounding', 'voicing', 'velum'];
  const arkit = arkitBlendshapes(faceRig(state, head));
  console.log(
    ipa,
    Object.fromEntries(pick.map((name) => [name, +state[name].toFixed(3)])),
    'mouthPress',
    +arkit.mouthPressLeft.toFixed(3)
  );
}
