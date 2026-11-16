/**
 * Generate data/lexicon/hi-words.txt lines (issue 47) from morpheme
 * descriptions: `word part+part+suffix`. Each part is read by the rules of
 * hindi.js on its own (schwa deletion does not cross a morpheme boundary),
 * a suffix of vowel signs adds its vowel, `ə` keeps a final schwa. Words
 * whose whole-word rule reading is already the same are reported and left
 * out.
 * node experiments/issue-47-hindi-words.mjs experiments/issue-47/hindi-morphemes.txt
 */
import { readFileSync } from 'node:fs';
import { hindiWordToIpa } from '../src/g2p/hindi.js';

const SUFFIXES = {
  'ें': 'ẽː',
  'ों': 'õː',
  'े': 'eː',
  'ी': 'iː',
  'ा': 'aː',
  ə: 'ə',
  ईय: 'iːj',
};
const out = [];
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const clean = line.replace(/#.*$/, '').trim();
  if (!clean) {
    if (line.startsWith('#')) {
      out.push(line);
    }
    continue;
  }
  const [word, parts] = clean.split(/\s+/);
  const ipa = parts
    .split('+')
    .map((part) => SUFFIXES[part] ?? hindiWordToIpa(part).ipa)
    .join('')
    .replace(/aːaː/g, 'aː')
    .replace(/ə(aː|iː|ʊ|ə)/g, '$1');
  const joined = parts
    .replace(/\+[अआ]/g, '+ा')
    .replaceAll('+', '')
    .replace('ə', '')
    .replace('ईय', 'ीय');
  const rules = hindiWordToIpa(word).ipa;
  if (rules === ipa) {
    console.error(`same as rules: ${word} ${ipa}`);
    continue;
  }
  out.push(`${word} ${ipa}`);
  if (joined.normalize('NFC') !== word.normalize('NFC')) {
    console.error(
      `check spelling: ${word} vs ${joined} -> ${ipa} (rules ${rules})`
    );
  }
}
console.log(out.join('\n'));
