// Print pause lengths, f0 before each pause and vowel loudness for
// punctuated sentences.
// Usage: node experiments/issue-5-prosody.mjs [lang text...]
import { textToIpa } from '../src/g2p/index.js';
import { planUtterance } from '../src/articulation/plan.js';

const samples =
  process.argv.length > 3
    ? [[process.argv[2], process.argv.slice(3).join(' ')]]
    : [
        ['en', 'It is red.'],
        ['en', 'Is it red?'],
        ['en', 'What is red?'],
        ['en', 'It is red!'],
        ['en', 'It is red...'],
        ['en', 'Red, green, blue; and white (or black) — fine.'],
        ['en', 'One. Two. Three.'],
      ];

const frame = (plan, time) =>
  Math.max(0, Math.min(plan.frameCount - 1, Math.round(time * plan.frameRate)));

for (const [lang, text] of samples) {
  const { ipa } = textToIpa(text, { lang });
  const plan = planUtterance(ipa, { language: lang });
  console.log(`\n${text}\n  ${ipa}  (${plan.duration.toFixed(2)} s)`);
  for (const segment of plan.segments) {
    if (segment.kind === 'pause' && segment.strength >= 1) {
      const f0 = plan.channels.f0[frame(plan, segment.start - 0.02)];
      console.log(
        `  pause ${segment.boundary ?? '-'} ${segment.duration.toFixed(3)} s, f0 before ${f0.toFixed(1)} Hz`
      );
    }
  }
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const loudness = vowels.map((segment) =>
    plan.channels.loudness[
      frame(plan, (segment.start + segment.end) / 2)
    ].toFixed(2)
  );
  const f0 = vowels.map((segment) =>
    plan.channels.f0[frame(plan, (segment.start + segment.end) / 2)].toFixed(0)
  );
  console.log(`  vowel f0 ${f0.join(' ')}`);
  console.log(`  vowel loudness ${loudness.join(' ')}`);
}
