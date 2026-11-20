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

function* bigramRows(source, words) {
  for (const item of source.split(' ')) {
    if (!item) {
      continue;
    }
    const comma = item.indexOf(',');
    const equals = item.indexOf('=', comma + 1);
    const previous = words[Number(item.slice(0, comma))];
    const next = words[Number(item.slice(comma + 1, equals))];
    yield [previous, next, Number(item.slice(equals + 1))];
  }
}

function discountedCost(count, previousCount) {
  return -0.3 * Math.log((count - 0.75) / previousCount) + 0.5;
}

/** Link the encoded pairs by destination without opening their cost maps. */
function indexBigrams(source, words) {
  // The smallest record is "0,0=1", plus the space between records.
  const capacity = Math.floor((source.length + 1) / 6);
  const records = new Uint32Array(capacity * 2);
  const counts = new Float64Array(capacity);
  const heads = new Uint32Array(words.length);
  const ids = new Map(words.map(({ word }, i) => [word, i]));
  let row = 0;
  for (let start = 0; start < source.length; ) {
    const comma = source.indexOf(',', start);
    const equals = source.indexOf('=', comma + 1);
    const space = source.indexOf(' ', equals + 1);
    const end = space < 0 ? source.length : space;
    const next = Number(source.slice(comma + 1, equals));
    records[row * 2] = Number(source.slice(start, comma));
    records[row * 2 + 1] = heads[next];
    counts[row] = Number(source.slice(equals + 1, end));
    heads[next] = ++row;
    start = end + 1;
  }
  return (word) => {
    let link = heads[ids.get(word)];
    if (!link) {
      return undefined;
    }
    const result = new Map();
    while (link) {
      const index = link - 1;
      const previous = words[records[index * 2]];
      result.set(previous.word, discountedCost(counts[index], previous.count));
      link = records[index * 2 + 1];
    }
    return result;
  };
}

function setTransition(transitions, word, previous, count) {
  let row = transitions.get(word);
  if (!row) {
    row = new Map();
    transitions.set(word, row);
  }
  row.set(previous.word, discountedCost(count, previous.count));
}

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
    let openRow;
    const rows = new Map();
    opened.set(language, {
      words,
      counts,
      get bigrams() {
        if (!bigrams) {
          bigrams = new Map();
          for (const [previous, next, count] of bigramRows(
            data.BIGRAMS,
            words
          )) {
            bigrams.set(`${previous.word}\t${next.word}`, count);
          }
        }
        return bigrams;
      },
      transitionRow(word) {
        if (!rows.has(word)) {
          openRow ??= indexBigrams(data.BIGRAMS, words);
          const row = openRow(word);
          if (row) {
            rows.set(word, row);
          }
        }
        return rows.get(word);
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
      setTransition(
        transitions,
        word,
        { word: previous, count: data.counts.get(previous) },
        count
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
    row ??=
      (data.transitionRow
        ? data.transitionRow(word)
        : transitionCosts(data).get(word)) ?? false;
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
