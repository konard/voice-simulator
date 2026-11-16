// Level of each vowel of `[crescendo]la la la la la la[/crescendo]` and of
// the plain text, and the warnings of a fast ramp (issue 52).
// Usage: node experiments/issue-52-crescendo.mjs
import { synthesize } from '../src/index.js';
import { levelDb } from '../src/analysis/mode-features.js';

function vowelLevels(text) {
  const r = synthesize(text, { tier: 'medium', seed: 1, markup: true });
  const levels = r.plan.segments
    .filter((s) => s.kind === 'vowel')
    .map((s) => {
      const from = Math.round(s.start * r.sampleRate);
      const to = Math.round(s.end * r.sampleRate);
      return levelDb(r.samples, from, to);
    });
  return { levels, r };
}
for (const text of [
  'la la la la la la',
  '[crescendo]la la la la la la[/crescendo]',
  '[diminuendo]la la la la la la[/diminuendo]',
]) {
  const { levels, r } = vowelLevels(text);
  console.log(text);
  console.log(
    ' ',
    levels.map((l) => l.toFixed(2)).join(' '),
    'last-first',
    (levels.at(-1) - levels[0]).toFixed(2),
    'offset',
    r.levelOffsetDb,
    'warnings',
    JSON.stringify(r.warnings)
  );
}
const fast = synthesize('[crescendo]la[/crescendo] la', {
  tier: 'low',
  markup: true,
});
console.log('fast ramp warnings', JSON.stringify(fast.warnings));
