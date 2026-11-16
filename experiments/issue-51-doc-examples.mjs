// Issue 51: the examples of docs/markup.md ("Intonation"): the IPA that
// textToIpa() writes for sentence types, phrase breaks and tune labels.
// Usage: node experiments/issue-51-doc-examples.mjs > experiments/issue-51-doc-examples.txt
import { textToIpa } from '../src/g2p/index.js';

const EXAMPLES = [
  ['You are coming.', { lang: 'en' }],
  ['Are you coming?', { lang: 'en' }],
  ['Where are you going?', { lang: 'en' }],
  ['Really?', { lang: 'en' }],
  ['Tea or coffee?', { lang: 'en' }],
  ["You are coming, aren't you?", { lang: 'en' }],
  ['Apples, pears and plums.', { lang: 'en' }],
  [
    'The old man who lived next to the station walked slowly to the market and bought some bread.',
    { lang: 'en' },
  ],
  ['Это мама?', { lang: 'ru' }],
  ['А ты?', { lang: 'ru' }],
  ['Какой сегодня день!', { lang: 'ru' }],
  ['Чай или кофе?', { lang: 'ru' }],
  ['你来？', { lang: 'zh' }],
  ['你去哪儿？', { lang: 'zh' }],
  ['तुम कहाँ जा रहे हो?', { lang: 'hi' }],
  ['[tune call]John![/tune]', { lang: 'en', markup: true }],
  ['*Anna* came with Manny.', { lang: 'en', markup: true }],
  ['<speak><vs:tune name="IK6">Какой голос!</vs:tune></speak>', { lang: 'ru' }],
];
for (const [text, options] of EXAMPLES) {
  const result = textToIpa(text, options);
  const tunes = result.modes
    .filter((span) => span.mode.tune)
    .map((span) => `${span.mode.tune} words ${span.from}-${span.to}`);
  console.log(
    `${text} [${options.lang}] → ${result.ipa}${tunes.length ? `; ${tunes.join(', ')}` : ''}`
  );
}
