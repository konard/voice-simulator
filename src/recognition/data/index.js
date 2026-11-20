/** Shipped public-domain counts. Modules contain counts, never IPA. */
import * as en from './en.js';
import * as ru from './ru.js';
import * as hi from './hi.js';
import * as zh from './zh.js';

const DATA = new Map([
  ['en', en],
  ['ru', ru],
  ['hi', hi],
  ['zh', zh],
]);
const opened = new Map();
const transitionsByTable = new WeakMap();

export function getCounts(language) {
  if (!DATA.has(language)) {
    throw new RangeError(`unsupported recognition language "${language}"`);
  }
  if (!opened.has(language)) {
    const data = DATA.get(language);
    const words = data.WORDS.split(' ')
      .filter(Boolean)
      .map((item) => {
        const at = item.lastIndexOf('=');
        return { word: item.slice(0, at), count: Number(item.slice(at + 1)) };
      });
    const counts = new Map(words.map((item) => [item.word, item.count]));
    let bigrams;
    opened.set(language, {
      words,
      counts,
      get bigrams() {
        if (!bigrams) {
          bigrams = new Map();
          for (const item of data.BIGRAMS.split(' ')) {
            if (!item) {
              continue;
            }
            const comma = item.indexOf(',');
            const equals = item.indexOf('=', comma + 1);
            const first = words[Number(item.slice(0, comma))].word;
            const second = words[Number(item.slice(comma + 1, equals))].word;
            bigrams.set(`${first}\t${second}`, Number(item.slice(equals + 1)));
          }
        }
        return bigrams;
      },
      total: words.reduce((sum, item) => sum + item.count, 0),
    });
  }
  return opened.get(language);
}

/** Precompute fixed bigram costs grouped by the destination word. */
function transitionCosts(data) {
  const table = data.bigrams;
  let transitions = transitionsByTable.get(table);
  if (!transitions) {
    transitions = new Map();
    for (const [key, count] of table) {
      const at = key.indexOf('\t');
      const previous = key.slice(0, at);
      const word = key.slice(at + 1);
      let row = transitions.get(word);
      if (!row) {
        row = new Map();
        transitions.set(word, row);
      }
      row.set(
        previous,
        -0.3 * Math.log((count - 0.75) / data.counts.get(previous)) + 0.5
      );
    }
    transitionsByTable.set(table, transitions);
  }
  return transitions;
}

/** Score multiple predecessor words for one candidate. */
export function wordTransition(data, word) {
  const backoff =
    -0.3 * Math.log((0.4 * (data.counts.get(word) ?? 1)) / data.total) + 0.5;
  let row;
  return (previous) => {
    if (!previous) {
      return backoff;
    }
    row ??= transitionCosts(data).get(word) ?? false;
    return (row ? row.get(previous) : undefined) ?? backoff;
  };
}

/** Discounted bigram probability with the specified unigram back-off. */
export function wordCost(data, previous, word) {
  const pair = previous && data.bigrams.get(`${previous}\t${word}`);
  const probability = pair
    ? (pair - 0.75) / data.counts.get(previous)
    : (0.4 * (data.counts.get(word) ?? 1)) / data.total;
  return -0.3 * Math.log(probability) + 0.5;
}
