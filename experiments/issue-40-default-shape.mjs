/**
 * Issue 40: with the free articulators at their defaults (missing, or set to
 * what the other channels imply) tractShape() gives the shape of the base
 * branch. Usage: node experiments/issue-40-default-shape.mjs <old checkout>
 * (for example `git worktree add /tmp/vs-old main`).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const oldRoot = path.resolve(process.argv[2] ?? '/tmp/vs-old');
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [oldShape, newShape, oldPlan, teeth, heads] = await Promise.all([
  load(oldRoot, 'src/articulation/tract-shape.js'),
  load(here, 'src/articulation/tract-shape.js'),
  load(oldRoot, 'src/articulation/plan.js'),
  load(here, 'src/articulation/teeth.js'),
  load(here, 'src/head-config.js'),
]);

const words = [
  'əiə',
  'əɪə',
  'əeə',
  'əɛə',
  'əæə',
  'əʌə',
  'əɑə',
  'əɔə',
  'əoə',
  'əʊə',
  'əuə',
  'əsə',
  'əmə',
  'əkə',
  'ata',
  'aʃa',
  'ula',
];
let worst = 0;
for (const word of words) {
  const plan = oldPlan.planUtterance(word);
  const segment = plan.segments[1];
  const frame = Math.round(
    ((segment.start + segment.end) / 2) * plan.frameRate
  );
  const state = {};
  for (const [name, values] of Object.entries(plan.channels)) {
    state[name] = values[frame];
  }
  const head = heads.normalizeHeadConfig({});
  const before = oldShape.tractShape(state, head);
  for (const variant of [
    state,
    {
      ...state,
      jaw: teeth.teethGap(state, head),
      lipProtrusion: 0.6 * state.rounding,
    },
  ]) {
    const after = newShape.tractShape(variant, head);
    let diff = Math.abs(after.length - before.length);
    for (let i = 0; i < before.areas.length; i++) {
      diff = Math.max(diff, Math.abs(after.areas[i] - before.areas[i]));
    }
    const same =
      after.velumIndex === before.velumIndex &&
      after.frication.position === before.frication.position &&
      JSON.stringify(after.teeth) === JSON.stringify(before.teeth);
    worst = Math.max(worst, diff);
    console.log(
      word,
      segment.ipa ?? '',
      diff.toExponential(2),
      same ? 'landmarks same' : 'LANDMARKS DIFFER'
    );
  }
}
console.log('largest difference', worst.toExponential(2));
