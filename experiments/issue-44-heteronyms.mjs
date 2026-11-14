// English heteronyms chosen by context (issue 44).
// Run: node experiments/issue-44-heteronyms.mjs > experiments/issue-44-heteronyms.txt
import { textToIpa } from '../src/index.js';
import { ENGLISH_HETERONYMS } from '../src/g2p/english-heteronyms.js';

const words = Object.keys(ENGLISH_HETERONYMS);
console.log(`table: ${words.length} words with the derived -s forms`);

for (const text of [
  // Section 2 of experiments/issue-11-audit-m3a.mjs.
  'I read the book yesterday.',
  'I will read the book.',
  'Did you record the record?',
  'I live here. A live show.',
  'A lead pipe. They lead the team.',
  'The wind blows. Wind the clock.',
  'A tear in her eye. Do not tear the page.',
  'Take a bow. A bow and arrow.',
  'Close the door. Stay close to me.',
  'I use it. It is of no use.',
  'A present for you. They present the plan.',
  'The object is red. I object to that.',
  'The dove flew. He dove in.',
  'A minute ago. A minute detail.',
  'The bass guitar. A bass swam by.',
  // More sentences.
  'He records songs. The records are old.',
  'I have read it. She read the letter.',
  'They live in a house. Many lives were saved.',
  'He was wound up. The wound healed.',
  'She is content with the content.',
  'We need to address the address.',
  'Please refuse the refuse.',
  'The nurse helped the invalid. The password is invalid.',
  'Increase the price. A large increase.',
  'I always read books.',
  'The record, I record it.',
]) {
  console.log(`en: ${JSON.stringify(text)}`);
  console.log(`    ${JSON.stringify(textToIpa(text, { lang: 'en' }).ipa)}`);
}

// Heteronyms keep their reading through the accents.
for (const accent of ['en-GB', 'en-AU', 'en-IN']) {
  const { ipa } = textToIpa('Did you record the record?', {
    lang: 'en',
    accent,
  });
  console.log(`${accent}: ${JSON.stringify(ipa)}`);
}
