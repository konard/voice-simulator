// Planned duration of English sentences with and without weak forms.
// Run: node experiments/issue-85-weak-form-durations.mjs
import { planUtterance, textToIpa } from '../src/index.js';

for (const text of [
  'a cup of tea for you',
  'I can do it',
  'He was at home',
  'Hello! This voice is simulated by sound waves in a 3D head.',
]) {
  const rows = [true, false].map((weakForms) => {
    const { ipa } = textToIpa(text, { lang: 'en', weakForms });
    const { duration } = planUtterance(ipa, { language: 'en' });
    return { ipa, duration };
  });
  const [weak, strong] = rows;
  const saved = (1 - weak.duration / strong.duration) * 100;
  console.log(
    `${text}\n  strong ${strong.duration.toFixed(3)} s  ${strong.ipa}\n` +
      `  weak   ${weak.duration.toFixed(3)} s  ${weak.ipa}  (-${saved.toFixed(1)} %)`
  );
}
