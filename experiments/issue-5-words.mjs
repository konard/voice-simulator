// Print the IPA and word source ranges of each language sample.
// Usage: node experiments/issue-5-words.mjs [lang text...]
import { LANGUAGES, textToIpa } from '../src/g2p/index.js';

const samples =
  process.argv.length > 3
    ? [[process.argv[2], process.argv.slice(3).join(' ')]]
    : Object.values(LANGUAGES).map((language) => [
        language.code,
        language.sample,
      ]);

for (const [lang, text] of samples) {
  const result = textToIpa(text, { lang });
  console.log(`\n${text}\n  ${result.ipa}`);
  for (const word of result.words) {
    console.log(
      `  ${word.sourceStart}-${word.sourceEnd} ${JSON.stringify(word.original)} -> ${word.ipa}${word.text === word.original ? '' : ` (${word.text})`}`
    );
  }
}
