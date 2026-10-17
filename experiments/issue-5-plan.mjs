// Print the plan segments of a short utterance with their tokens.
// Usage: node experiments/issue-5-plan.mjs [lang text...]
import { prepareUtterance } from '../src/synthesize.js';

const lang = process.argv[2] ?? 'en';
const text = process.argv.slice(3).join(' ') || 'Hello, world.';
const { ipa, plan } = prepareUtterance(text, { lang });
console.log(ipa, plan.duration, plan.frameCount, plan.frameRate);
for (const segment of plan.segments) {
  console.log(
    segment.kind.padEnd(9),
    segment.start.toFixed(3),
    segment.end.toFixed(3),
    segment.token?.symbol ?? '-',
    segment.token?.word ?? '',
    plan.tokens.indexOf(segment.token)
  );
}
