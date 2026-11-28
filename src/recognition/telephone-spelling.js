/** Resolve equal-pronunciation alternatives using adjacent words. Unlicense. */
import { getCounts } from './data/index.js';
import { ASSOCIATIONS as first } from './data/en-homophone-context-0.js';
import { ASSOCIATIONS as second } from './data/en-homophone-context-1.js';

function wordOrder(source, start, end, word) {
  const length = Math.min(end - start, word.length);
  for (let i = 0; i < length; i++) {
    const order = source.charCodeAt(start + i) - word.charCodeAt(i);
    if (order !== 0) {
      return order;
    }
  }
  return end - start - word.length;
}

function findAssociation(source, before, word) {
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const start = source.lastIndexOf(' ', middle - 1) + 1;
    const separator = source.indexOf('/', start);
    const equals = source.indexOf('=', separator + 1);
    const next = source.indexOf(' ', equals + 1);
    const end = next === -1 ? source.length : next;
    const order =
      wordOrder(source, start, separator, before) ||
      wordOrder(source, separator + 1, equals, word);
    if (order === 0) {
      return Number(source.slice(equals + 1, end)) / 100;
    }
    if (order < 0) {
      low = end + 1;
    } else {
      high = start;
    }
  }
}

/** Look up a word pair directly in the two sorted corpus tables. */
export function telephoneAssociation(before, word) {
  return (
    findAssociation(first, before, word) ??
    findAssociation(second, before, word) ??
    0
  );
}

export function spellTelephoneWords(proposals, clauseEnds) {
  if (proposals.every(({ alternatives }) => alternatives.length === 1)) {
    return proposals.map(({ alternatives }) => alternatives[0]);
  }
  const { wordCount } = getCounts('en');
  let paths = [{ word: '', score: 0, previous: null }];
  for (const [i, { word, alternatives }] of proposals.entries()) {
    const reset = i === 0 || clauseEnds.has(i - 1);
    paths = alternatives.map((candidate) => {
      const prior =
        0.2 * Math.log(wordCount(candidate) ?? 1) +
        (word === candidate ? 0.15 : 0);
      let best = null;
      for (const previous of paths) {
        const context = reset
          ? 0
          : telephoneAssociation(previous.word, candidate);
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
