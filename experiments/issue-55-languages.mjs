// Issue 55: the sentences of the emotion listening test in every language,
// plain and with `[neutral 1]` and `[angry 1]` (markup), and their IPA.
// Usage: node experiments/issue-55-languages.mjs
import { prepareUtterance } from '../src/index.js';

const SENTENCES = [
  ['en', 'The train leaves at seven.'],
  ['en', 'I will see you on Monday.'],
  ['ru', 'Поезд отправляется в семь.'],
  ['ru', 'Увидимся в понедельник.'],
  ['hi', 'ट्रेन सात बजे छूटती है।'],
  ['hi', 'मैं तुमसे सोमवार को मिलूँगा।'],
  ['zh', '火车七点出发。'],
  ['zh', '我们星期一见。'],
];
for (const [lang, text] of SENTENCES) {
  for (const input of [
    text,
    `[neutral 1]${text}[/neutral]`,
    `[angry 1]${text}[/angry]`,
  ]) {
    const { ipa, plan, warnings } = prepareUtterance(input, {
      lang,
      seed: 1,
      markup: input !== text,
    });
    console.log(
      lang,
      JSON.stringify(input.slice(0, 14)),
      ipa,
      plan.duration.toFixed(3),
      JSON.stringify(
        plan.modes.map((span) => `${span.emotion.name} ${span.effort}`)
      ),
      warnings?.length ? warnings : ''
    );
  }
}
