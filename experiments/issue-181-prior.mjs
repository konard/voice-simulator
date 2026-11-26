// Issue 181: run another experiment with the English unigram counts of the
// decoding network replaced by a candidate prior that also uses the CC0
// Common Voice word counts (data/lexicon/en-counts.txt).
// PRIOR=unseen|max|mix:0.5|cv node experiments/issue-181-prior.mjs \
//   experiments/issue-75-hmm-eval.mjs telephone en male 0 20
// LANGS lists the network languages to patch (default "en,ru,hi,zh" and "en").
// Unlicense.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { getLexicon } from '../src/recognition/lexicon.js';

const spoken = new Map(
  readFileSync(
    new globalThis.URL('../data/lexicon/en-counts.txt', import.meta.url),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => line.split(' '))
    .map(([w, c]) => [w, Number(c)])
);
let spokenTotal = 0;
for (const c of spoken.values()) {
  spokenTotal += c;
}
const lex = getLexicon('en');
const [kind, arg] = (process.env.PRIOR ?? 'unseen').split(':');
const prior = (word, count) => {
  const cv = (spoken.get(word) ?? 0) / spokenTotal;
  if (kind === 'unseen') {
    return count > 1 ? count : Math.max(count, cv * lex.total);
  }
  if (kind === 'max') {
    return Math.max(count, cv * lex.total);
  }
  if (kind === 'mix') {
    return (
      lex.total *
      (((1 - Number(arg)) * Math.max(count, 3)) / lex.total + Number(arg) * cv)
    );
  }
  if (kind === 'cv') {
    return Math.max(cv * lex.total, 0.5);
  }
  return count;
};
const model = getHmmModel();
const lists = (process.env.LANGS ?? 'en,ru,hi,zh;en').split(';');
for (const list of lists) {
  const network = getNetwork(model, list.split(','), {});
  let changed = 0;
  for (const w of network.words) {
    if (w.lang === 'en' && !w.oov) {
      w.count = prior(w.word, w.count ?? 1);
      changed++;
    }
  }
  console.error(
    `PRIOR=${process.env.PRIOR ?? 'unseen'} patched ${changed} English words in ${list}`
  );
}
const [script, ...rest] = process.argv.slice(2);
process.argv = [process.argv[0], script, ...rest];
await import(pathToFileURL(script).href);
