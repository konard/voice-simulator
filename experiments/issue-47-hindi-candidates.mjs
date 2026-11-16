/**
 * Candidates for data/lexicon/hi-words.txt (issue 47): frequent Hindi words
 * where the schwa deletion of hindi.js likely fails.
 *  final:  a Sanskrit final cluster (्र ्य ्व) whose schwa is spoken
 *  stem:   a suffixed form whose stem is a corpus word and whose rule
 *          reading differs from stem + suffix (morpheme boundary)
 * node experiments/issue-47-hindi-candidates.mjs <counts file>
 */
import { readFileSync } from 'node:fs';
import { hindiWordToIpa } from '../src/g2p/hindi.js';

const words = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split(' ')[0]);
const known = new Set(words);
const ipa = (w) => hindiWordToIpa(w).ipa;
const SUFFIXES = [
  ['ें', 'ẽː'],
  ['ों', 'õː'],
  ['ी', 'iː'],
  ['े', 'eː'],
  ['ा', 'aː'],
  ['ियों', 'ɪjõː'],
  ['ाएं', 'aːẽː'],
  ['ने', 'neː'],
  ['ना', 'naː'],
  ['कर', 'kəɾ'],
  ['ता', 't̪aː'],
  ['ती', 't̪iː'],
  ['ते', 't̪eː'],
  ['वाले', 'ʋaːleː'],
  ['ों', 'õː'],
];
for (const word of words) {
  if (/्[रयव]$/.test(word)) {
    console.log(`final\t${word}\t${ipa(word)}\t${ipa(word)}ə`);
    continue;
  }
  for (const [suffix, sipa] of SUFFIXES) {
    if (!word.endsWith(suffix)) {
      continue;
    }
    const stem = word.slice(0, -suffix.length);
    if ([...stem].length < 3 || !known.has(stem)) {
      continue;
    }
    // a vowel suffix replaces nothing: stem reading + suffix
    const joined = ipa(stem) + sipa;
    if (joined !== ipa(word)) {
      console.log(`stem\t${word}\t${ipa(word)}\t${joined}`);
    }
    break;
  }
}
