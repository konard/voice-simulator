/**
 * Issue 57 acceptance: the IPA without an `accent` option is the same as
 * before. Takes every string literal of tests/accents.test.js and
 * tests/text-to-ipa.test.js of the reference checkout (the sentences of
 * those tests and more) and prints textToIpa(text, {lang}).ipa for the
 * languages auto, en, ru, hi and zh with the checkout given as the first
 * argument (default: this one). Diff the output of two checkouts:
 *   node experiments/issue-57-ipa-identity.mjs ../main ../main > main.txt
 *   node experiments/issue-57-ipa-identity.mjs . ../main > branch.txt
 * The second argument is the checkout whose test files give the texts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const reference = path.resolve(process.argv[3] ?? root);
const { textToIpa } = await import(
  pathToFileURL(path.join(root, 'src/g2p/index.js')).href
);

const texts = new Set();
for (const file of ['tests/accents.test.js', 'tests/text-to-ipa.test.js']) {
  const source = readFileSync(path.join(reference, file), 'utf8');
  for (const match of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/gu)) {
    texts.add(match[1]);
  }
}
let count = 0;
for (const text of [...texts].sort()) {
  for (const lang of ['auto', 'en', 'ru', 'hi', 'zh']) {
    let ipa;
    try {
      ipa = textToIpa(text, { lang }).ipa;
    } catch (error) {
      ipa = `throws ${error.name}`;
    }
    console.log(`${lang}\t${JSON.stringify(text)}\t${ipa}`);
    count++;
  }
}
console.error(`${texts.size} texts, ${count} transcriptions`);
