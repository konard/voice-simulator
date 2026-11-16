// Print the IPA of the issue's examples for each accent (issue 57).
import { textToIpa } from '../src/g2p/index.js';

const cases = [
  [
    'the thing with strong street wives and bad bed',
    'en',
    { code: 'en-x-ru', strength: 0.5 },
  ],
  ['the thing with strong street wives and bad bed', 'en', undefined],
  ['pit', 'en', { code: 'en-x-ru', strength: 0.5 }],
  ['thing', 'en', { code: 'en-x-ru', strength: 0 }],
  ['thing', 'en', 'en-x-ru'],
  ['school', 'en', 'en-x-hi'],
  ['bed street', 'en', 'en-x-zh'],
  ['price about', 'en', 'en-CA'],
  ['хорошо говорит', 'ru', 'ru-x-north'],
  ['город снег друг его', 'ru', 'ru-x-south'],
  ['ज़रा फ़ोन शहर', 'hi', 'hi-x-east'],
  ['是', 'zh', 'zh-TW'],
  ['一点儿', 'zh', 'zh-TW'],
  ['一点儿', 'zh', undefined],
  ['女儿', 'zh', 'zh-TW'],
  ['南', 'zh', 'zh-x-south'],
];
for (const [text, lang, accent] of cases) {
  const result = textToIpa(text, { lang, accent });
  console.log(
    JSON.stringify(accent),
    text,
    '→',
    result.ipa,
    result.accent,
    result.accentLevel
  );
}
