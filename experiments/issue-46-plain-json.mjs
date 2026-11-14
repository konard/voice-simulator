// Prints the words and timeline of sentences read as written, so two
// checkouts can be compared byte for byte (the spoken fields of #46 must
// not appear here):
//   node experiments/issue-46-plain-json.mjs > a.json
import { prepareUtterance, textToIpa } from '../src/index.js';

for (const [lang, text] of [
  ['en', 'Hello world, how are you?'],
  ['ru', 'Привет, мир!'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好，声音'],
]) {
  const { timeline } = prepareUtterance(text, { lang });
  const words = textToIpa(text, { lang }).words;
  console.log(JSON.stringify({ lang, text, words, timeline }));
}
