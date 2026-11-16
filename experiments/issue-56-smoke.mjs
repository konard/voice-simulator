// Issue 56: quick look at the plan of every sound (lengths, parts).
import { planUtterance, textToIpa } from '../src/index.js';

const texts = process.argv.slice(2);
for (const text of texts.length
  ? texts
  : ['Yes [laugh]', '[inhale] Yes', '[click]']) {
  const { ipa, modes } = textToIpa(text, { markup: true });
  const plan = planUtterance(ipa, { modes });
  console.log(
    JSON.stringify(text),
    ipa,
    plan.duration.toFixed(3),
    JSON.stringify(plan.sounds)
  );
  for (const s of plan.segments) {
    console.log(
      '  ',
      s.kind.padEnd(9),
      (s.token?.symbol ?? '-').padEnd(10),
      s.start.toFixed(3),
      s.end.toFixed(3),
      s.sound ?? '',
      s.envelope ?? '',
      s.soundPitch ?? ''
    );
  }
}
