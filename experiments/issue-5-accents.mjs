// Print English words in each accent next to General American.
// Usage: node experiments/issue-5-accents.mjs [words...]
import { textToIpa } from '../src/g2p/index.js';
import { ACCENTS } from '../src/g2p/accents.js';

const words =
  process.argv.length > 2
    ? process.argv.slice(2)
    : `car bath water lot thought dog go nurse start near square carry very
      mary tune new hurry sorry fire pure father want quality all serious
      hello world dance can't better city butter party forty`.split(/\s+/);

for (const word of words) {
  const row = ACCENTS.en.map(
    ({ code }) => `${code} ${textToIpa(word, { lang: 'en', accent: code }).ipa}`
  );
  console.log(`${word.padEnd(10)} ${row.join('  ')}`);
}
for (const text of ['far away', 'the car is here', 'four apples. Answer.']) {
  console.log(
    `${text}: ${textToIpa(text, { lang: 'en', accent: 'en-GB' }).ipa}`
  );
}
