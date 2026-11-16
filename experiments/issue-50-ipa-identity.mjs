// Plain IPA (no marks) gives the same tokens as the parser of the base
// commit.
// Needs the base parser at src/ipa/parse-old-tmp.js:
//   git show <base>:src/ipa/parse.js > src/ipa/parse-old-tmp.js
// Run: node experiments/issue-50-ipa-identity.mjs
import { parseIpa } from '../src/ipa/parse.js';
import { textToIpa, LANGUAGES } from '../src/g2p/index.js';

const old = await import('../src/ipa/parse-old-tmp.js');
const texts = [
  ...Object.values(LANGUAGES).map((language) => language.sample),
  'Hello (world)... "quoted", a; b: c! Really? Wait (...) ok (1) [2] 3 * 4.',
  'It costs $3.50 on 12/03/2021, Dr. Smith said: "no".',
  'Привет, мир! Как дела?',
  '你好，世界。',
  'नमस्ते दुनिया।',
];
const ipas = [
  ...texts.map((text) => textToIpa(text).ipa),
  'ˈhɛloʊ (ˈwɝld) ‖ ma˨˩˦ t͡ʃa ʦa ˈˈma',
  "ˈma'ma ma:",
];
let differ = 0;
for (const ipa of ipas) {
  const a = JSON.stringify(old.parseIpa(ipa));
  const b = parseIpa(ipa);
  const same = a === JSON.stringify({ tokens: b.tokens, unknown: b.unknown });
  differ += same ? 0 : 1;
  console.log(same ? 'same' : 'DIFFERENT', JSON.stringify(ipa));
}
console.log(`${ipas.length - differ}/${ipas.length} identical`);
