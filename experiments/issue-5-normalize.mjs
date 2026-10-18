// Print textToIpa output (IPA and words with source ranges) for samples.
// Usage: node experiments/issue-5-normalize.mjs [lang text...]
import { textToIpa } from '../src/g2p/index.js';

const samples =
  process.argv.length > 3
    ? [[process.argv[2], process.argv.slice(3).join(' ')]]
    : [
        ['en', 'Hello world'],
        [
          'en',
          'Dr. Smith paid $3.50 on Jan. 5, 2024 at 5:30 pm, i.e. 20% more!',
        ],
        [
          'en',
          'In 1984 the 1990s; the 21st century & 3 cats (approx. 2.5 kg) etc. What is it?',
        ],
        ['en', 'Is it the BBC or NASA? No. 5 is -3 degrees, 5-7 km/h.'],
        ['ru', 'Привет, мир'],
        [
          'ru',
          'В 2024 году 15 марта я заплатил 1 500 руб. за 2,5 кг, т.е. 25%. Где МГУ?',
        ],
        ['hi', 'नमस्ते! 2024 में 15 किमी, ₹500 का 3वाँ।'],
        ['zh', '你好世界'],
        ['zh', '我有2个苹果，2024年3月5日下午3:05，花了¥12.5，增长了30%。'],
        ['zh', 'ni3 hao3'],
        ['en', '3 cats'],
      ];

for (const [lang, text] of samples) {
  const result = textToIpa(text, { lang });
  console.log(`\n[${lang}] ${text}\n  ${result.ipa}`);
  for (const word of result.words) {
    const range = `[${word.sourceStart},${word.sourceEnd})`;
    console.log(`   ${word.text} ${range} "${word.original}" ${word.ipa}`);
  }
}
