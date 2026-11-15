// Compare textToIpa() with the expected IPA of the clitics prototype (issue 86).
// Run: node experiments/issue-86-check-prototype.mjs
import { readFileSync } from 'node:fs';
import { textToIpa } from '../src/index.js';
import {
  RUSSIAN_ENCLITICS,
  RUSSIAN_PROCLITICS,
} from '../src/g2p/russian-clitics.js';

const lines = readFileSync(
  new globalThis.URL(
    './issue-11-russian-clitics-prototype.txt',
    import.meta.url
  ),
  'utf8'
)
  .trim()
  .split('\n');
let failures = 0;
for (const line of lines) {
  const [, text, expected] = /^ru (.*): "(.*)" {3}today/u.exec(line);
  const actual = textToIpa(text, { lang: 'ru' }).ipa;
  // The prototype prints | for a break and leaves out the final break.
  const comparable = actual
    .replace(/ [,.?!;…] /gu, ' | ')
    .replace(/ [.?!…]$/u, '');
  const ok = comparable === expected;
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}: ${JSON.stringify(actual)}`);
}
console.log('# single clitics');
for (const word of [
  ...Object.keys(RUSSIAN_PROCLITICS),
  ...Object.keys(RUSSIAN_ENCLITICS),
]) {
  console.log(
    `${word}: ${JSON.stringify(textToIpa(word, { lang: 'ru' }).ipa)}`
  );
}
console.log(`failures: ${failures} of ${lines.length}`);
