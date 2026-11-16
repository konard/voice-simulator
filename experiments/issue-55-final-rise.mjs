// The f0 of the last vowel of "[afraid]…[/afraid]" (issue 55).
// node experiments/issue-55-final-rise.mjs [tag]
import { prepareUtterance } from '../src/index.js';

const tag = process.argv[2] ?? 'afraid';
const text = `[${tag}]The train leaves at seven.[/${tag}]`;
const { plan } = prepareUtterance(text, { seed: 1, markup: true });
const vowels = plan.segments.filter((s) => s.kind === 'vowel');
const last = vowels.at(-1);
console.log(
  plan.segments
    .map(
      (s) =>
        `${s.kind[0]}:${s.token?.phoneme?.symbol ?? s.token?.symbol ?? ''}${s.token?.stress === 1 ? "'" : ''}:${s.duration.toFixed(3)}`
    )
    .join(' ')
);
const a = Math.round(last.start * plan.frameRate);
const b = Math.round(last.end * plan.frameRate);
const out = [];
for (let f = a - 3; f <= b + 3; f++) {
  out.push(plan.channels.f0[f].toFixed(0));
}
console.log(
  'last vowel',
  last.token.phoneme?.symbol,
  last.duration.toFixed(3),
  out.join(' ')
);
