/**
 * Shipped word bigrams around the given words: count and cost of every
 * pair whose either side is one of them, and the unigram backoff cost.
 * node experiments/issue-75-bigram-lookup.mjs <lang> <word...>
 * Unlicense.
 */
import { getCounts } from '../src/recognition/data/index.js';

const [lang, ...targets] = process.argv.slice(2);
const data = getCounts(lang);
for (const word of targets) {
  const count = data.counts.get(word);
  const backoff = -0.3 * Math.log((0.4 * (count ?? 1)) / data.total) + 0.5;
  console.log(`${word} count ${count} backoff cost ${backoff.toFixed(2)}`);
  const row = data.transitionRow(word);
  console.log(
    `  after: ${row ? [...row].map(([p, c]) => `${p}:${c.toFixed(2)}`).join(' ') : '-'}`
  );
  const before = [...data.bigrams]
    .filter(([key]) => key.startsWith(`${word}\t`))
    .map(([key, n]) => `${key.split('\t')[1]}:${n}`);
  console.log(`  before: ${before.join(' ') || '-'}`);
}
