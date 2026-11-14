// Words and syllables of the timeline of a Russian phrase with clitics (issue 86).
// Run: node experiments/issue-86-timeline.mjs
import { planUtterance, textToIpa, utteranceTimeline } from '../src/index.js';

for (const text of ['из-за дома', 'Я не знаю, как же', 'с Иваном']) {
  const { ipa, words } = textToIpa(text, { lang: 'ru' });
  const plan = planUtterance(ipa);
  const timeline = utteranceTimeline(plan, { words, ipa, language: 'ru' });
  console.log(`${text}: ${JSON.stringify(ipa)}`);
  for (const word of timeline.words) {
    const syllables = word.syllables.map((s) => `${s.ipa}=${s.text ?? '?'}`);
    console.log(
      `  ${word.text} ${word.start.toFixed(3)}-${word.end.toFixed(3)} ${syllables.join(' ')}`
    );
  }
}
