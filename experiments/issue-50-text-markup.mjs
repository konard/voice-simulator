// textToIpa with markup: the IPA, the mode spans, the word ranges, and
// whether parsing the IPA gives the same spans back.
// Run: node experiments/issue-50-text-markup.mjs
import { textToIpa } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';

const cases = [
  ['[whisper]Hello[/whisper] world.', { markup: true }],
  ['<speak>Hello <emphasis>world</emphasis>.</speak>', {}],
  ['<speak><prosody rate="fast" pitch="+2st">a b</prosody> c</speak>', {}],
  [
    'Wait [pause 0.5] a [laugh] *really* [loud]big[/loud] deal.',
    { markup: true },
  ],
  [
    '<speak>On <say-as interpret-as="date">12/03/2021</say-as> <sub alias="doctor">Dr.</sub> <phoneme ph="təˈmɑːtoʊ">tomato</phoneme> <lang xml:lang="ru">привет</lang> ok</speak>',
    {},
  ],
  [
    '<speak>a <break time="300ms"/> b <break strength="x-strong"/> c <vs:sound name="cough"/></speak>',
    {},
  ],
  [
    '[soft][breathy 1]quiet words[/breathy][/soft] and [fast]quick ones[/fast].',
    { markup: true },
  ],
];
let mismatches = 0;
for (const [text, options] of cases) {
  const result = textToIpa(text, options);
  const back = parseIpa(result.ipa);
  const same =
    JSON.stringify(back.modes) === JSON.stringify(result.modes) &&
    back.unknown.length === 0;
  const written = result.modes.every((span) => span.mode.emphasis !== 0.5);
  mismatches += same || !written ? 0 : 1;
  console.log(JSON.stringify(text));
  console.log('  ipa:', result.ipa);
  console.log('  unknown:', back.unknown);
  console.log(
    '  modes:',
    result.modes.map((span) => `${span.from}-${span.to}`).join(' '),
    same ? '(same as parseIpa)' : '(parseIpa differs)'
  );
  console.log(
    '  words:',
    result.words
      .map(
        (word) =>
          `${word.text}@${word.sourceStart}-${word.sourceEnd}=${JSON.stringify(word.original)}`
      )
      .join(' ')
  );
  if (result.warnings.length) {
    console.log('  warnings:', result.warnings);
  }
}
console.log(`${mismatches} cases where parseIpa gives other spans`);
