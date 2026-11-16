/**
 * Print the rule reading of the most frequent Hindi words (issue 47) to
 * find the words where schwa deletion fails.
 * node experiments/issue-47-hindi-rules.mjs <counts file> [from] [to]
 */
import { readFileSync } from 'node:fs';
import { hindiWordToIpa } from '../src/g2p/hindi.js';

const [file, from = '0', to = '400'] = process.argv.slice(2);
const words = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .slice(Number(from), Number(to));
for (const line of words) {
  const [word, count] = line.split(' ');
  console.log(`${word}\t${count}\t${hindiWordToIpa(word).ipa}`);
}
