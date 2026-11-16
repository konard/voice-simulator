// Prints the phonation channels of a plan (issue 54).
// node experiments/issue-54-plan-check.mjs "<text>" [ipa]
import { prepareUtterance } from '../src/index.js';
const text =
  process.argv[2] ??
  '<vs:phonation name="breathy" degree="1">Please call Stella.</vs:phonation>';
const ipa = process.argv[3] === 'ipa';
const prepared = prepareUtterance(text, {
  tier: 'medium',
  seed: 1,
  markup: !ipa,
  ipa,
  language: process.argv[4],
});
const plan = prepared.plan ?? prepared;
console.log(Object.keys(plan), Object.keys(plan.channels ?? {}));
const stat = (a) =>
  a
    ? `max ${Math.max(...a).toFixed(3)} min ${Math.min(...a).toFixed(3)}`
    : 'none';
for (const name of ['tension', 'breath', 'creak', 'falsetto', 'harsh', 'f0']) {
  console.log(name, stat(plan.channels?.[name]));
}
console.log(plan.modes);
console.log(
  plan.segments
    .map(
      (s) =>
        `${s.kind}:${s.token?.symbol ?? ''}:${(s.duration * 1000).toFixed(0)}`
    )
    .join(' ')
);
