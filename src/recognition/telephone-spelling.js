/** Resolve equal-pronunciation alternatives using adjacent words. Unlicense. */
import { getCounts } from './data/index.js';
import { ASSOCIATIONS } from './data/en-homophone-context.js';

let scores;
function association(before, word) {
  scores ??= new Map(
    ASSOCIATIONS.split(' ').map((pair) => {
      const i = pair.lastIndexOf('=');
      return [pair.slice(0, i), Number(pair.slice(i + 1)) / 100];
    })
  );
  return scores.get(`${before}/${word}`) ?? 0;
}

export function spellTelephoneWords(proposals, clauseEnds) {
  if (proposals.every(({ alternatives }) => alternatives.length === 1)) {
    return proposals.map(({ alternatives }) => alternatives[0]);
  }
  const { counts } = getCounts('en');
  let paths = [{ word: '', score: 0, previous: null }];
  for (const [i, { word, alternatives }] of proposals.entries()) {
    const reset = i === 0 || clauseEnds.has(i - 1);
    paths = alternatives.map((candidate) => {
      const prior =
        0.2 * Math.log(counts.get(candidate) ?? 1) +
        (word === candidate ? 0.15 : 0);
      let best = null;
      for (const previous of paths) {
        const context = reset ? 0 : association(previous.word, candidate);
        const score = previous.score + prior + context;
        if (!best || score > best.score) {
          best = { word: candidate, score, previous };
        }
      }
      return best;
    });
  }
  const words = [];
  let best = paths.reduce((a, b) => (a.score >= b.score ? a : b));
  while (best.previous) {
    words.push(best.word);
    best = best.previous;
  }
  return words.reverse();
}
