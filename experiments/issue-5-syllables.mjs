// Print the syllables of each language sample and of a few hard words.
// Usage: node experiments/issue-5-syllables.mjs [lang text...]
import { LANGUAGES, textToIpa } from '../src/g2p/index.js';
import { syllabifyIpa } from '../src/ipa/syllables.js';

const samples =
  process.argv.length > 3
    ? [[process.argv[2], process.argv.slice(3).join(' ')]]
    : [
        ...Object.values(LANGUAGES).map((language) => [
          language.code,
          language.sample,
        ]),
        ['en', 'extra strength apples serious window mountain quality'],
        ['ru', 'здравствуйте сестра карман'],
      ];

for (const [lang, text] of samples) {
  const { ipa } = textToIpa(text, { lang });
  const words = syllabifyIpa(ipa, { language: lang });
  console.log(`${text}\n  ${words.map((word) => word.join('.')).join(' ')}`);
}
