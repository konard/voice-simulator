/** Print plan segment units next to word IPA phones. Unlicense. */
import { synthesize, textToIpa, tokenize } from '../src/index.js';

const [lang = 'en', text = 'The quick brown fox jumps over the lazy dog.'] =
  process.argv.slice(2);
const spoken = synthesize(text, {
  lang,
  tier: 'telephone',
  head: 'random',
  preset: 'male',
  seed: 1,
});
console.log(
  spoken.plan.segments
    .map((s) =>
      s.kind === 'pause'
        ? `|${(s.duration * 1000).toFixed(0)}`
        : s.kind === 'release'
          ? `${s.token.symbol}_r`
          : s.token.symbol
    )
    .join(' ')
);
for (const w of textToIpa(text, { lang }).words) {
  console.log(w.original, w.ipa, tokenize(w.ipa, 'phone').join(' '));
}
console.log(
  Object.keys(spoken.plan),
  Object.keys(spoken.plan.segments[1]),
  Object.keys(spoken.plan.segments[1].token)
);
