// Accents with the speech markup of #50: the accent applies to the words
// of its language in marked-up text and in each language span.
// Run: node experiments/issue-57-markup-accent.mjs
import { textToIpa } from '../src/index.js';

const cases = [
  ['the thing', { lang: 'en', accent: 'en-x-ru' }],
  ['<speak>the thing</speak>', { lang: 'en', accent: 'en-x-ru' }],
  [
    '[whisper]the thing[/whisper]',
    { lang: 'en', accent: 'en-x-ru', markup: true },
  ],
  ['город', { lang: 'ru', accent: 'ru-x-south' }],
  ['<speak>город</speak>', { lang: 'ru', accent: 'ru-x-south' }],
  [
    '<speak>the thing <lang xml:lang="ru">город</lang></speak>',
    { lang: 'en', accent: 'en-x-ru' },
  ],
  [
    '<speak>the thing <lang xml:lang="ru">город</lang></speak>',
    { lang: 'en', accent: 'ru-x-south' },
  ],
  ['<speak>the thing</speak>', { lang: 'en' }],
];
for (const [text, options] of cases) {
  const result = textToIpa(text, options);
  console.log(
    JSON.stringify(text),
    JSON.stringify(options),
    '->',
    result.ipa,
    `(accent ${result.accent}, level ${result.accentLevel})`
  );
}
