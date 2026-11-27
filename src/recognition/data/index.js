/** Shipped public-domain counts. Modules contain counts, never IPA. */
import * as en from './en.js';
import * as ru from './ru.js';
import * as hi from './hi.js';
import * as zh from './zh.js';
import * as enSpoken from './en-spoken.js';

const DATA = new Map([
  ['en', en],
  ['ru', ru],
  ['hi', hi],
  ['zh', zh],
]);
// Spoken-language counts that the HMM word decoder backs off to (issue 181).
const SPOKEN = new Map([['en', enSpoken]]);
const opened = new Map();
const transitionsByTable = new WeakMap();
let readTransitions;

export function installWordTransitionReader(read) {
  readTransitions = read;
}

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

/** A destination's range in offsets points to (previous word ID, count) pairs. */
export function packWordTransitions(language) {
  const { words } = getCounts(language);
  const ids = new Map(words.map(({ word }, index) => [word, index]));
  const rows = Array.from(words, () => []);
  for (const [previous, next, count] of bigramRows(
    DATA.get(language).BIGRAMS,
    words
  )) {
    rows[ids.get(next.word)].push(ids.get(previous.word), count);
  }
  const offsets = [0];
  const pairs = [];
  for (const row of rows) {
    // The source index opens each row in reverse order.
    for (let i = row.length - 2; i >= 0; i -= 2) {
      pairs.push(row[i], row[i + 1]);
    }
    offsets.push(pairs.length);
  }
  return [offsets, pairs];
}

export function openWordTransitions(words, offsets, pairs) {
  if (
    offsets.length !== words.length + 1 ||
    offsets[0] !== 0 ||
    offsets.at(-1) !== pairs.length
  ) {
    return undefined;
  }
  const ids = new Map(words.map(({ word }, i) => [word, i]));
  return (word) => {
    const id = ids.get(word);
    const start = offsets[id];
    const end = offsets[id + 1];
    if (!(start < end)) {
      return undefined;
    }
    const result = new Map();
    for (let i = start; i < end; i += 2) {
      const previous = words[pairs[i]];
      result.set(previous.word, discountedCost(pairs[i + 1], previous.count));
    }
    return result;
  };
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
  let previous = 0;
  let next = 0;
  let value = 0;
  const zero = '0'.charCodeAt(0);
  const comma = ','.charCodeAt(0);
  const equals = '='.charCodeAt(0);
  // The generator writes ASCII integers as "previous,next=count". Parse
  // directly into the arrays, with the end of the text acting as a space.
  for (let offset = 0; offset <= source.length; offset++) {
    const code = source.charCodeAt(offset);
    const digit = code - zero;
    if (digit >= 0 && digit <= 9) {
      value = value * 10 + digit;
      continue;
    }
    if (code === comma) {
      previous = value;
    } else if (code === equals) {
      next = value;
    } else if (value > 0) {
      records[row * 2] = previous;
      records[row * 2 + 1] = heads[next];
      counts[row] = value;
      heads[next] = ++row;
    }
    value = 0;
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

/**
 * Give every word a `prior`: its share of the spoken-language counts scaled
 * to `total`, or 1 (never seen) when they lack it. The books behind the
 * counts never saw everyday words such as "hello", which then lost to
 * "her no" and "hollow" (issue 181).
 */
function addSpokenPrior(words, total, spoken) {
  if (!spoken) {
    return;
  }
  const shares = new Map();
  for (const item of spoken.SPOKEN.split(' ')) {
    const at = item.lastIndexOf('=');
    if (at > 0) {
      shares.set(item.slice(0, at), Number(item.slice(at + 1)));
    }
  }
  const scale = total / spoken.SPOKEN_WORDS;
  for (const item of words) {
    item.prior = Math.max(1, (shares.get(item.word) ?? 0) * scale);
  }
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
    const total = words.reduce((sum, item) => sum + item.count, 0);
    addSpokenPrior(words, total, SPOKEN.get(language));
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
          openRow ??=
            readTransitions?.(language, words) ??
            indexBigrams(data.BIGRAMS, words);
          const row = openRow(word);
          if (row) {
            if (rows.size === 1024) {
              rows.delete(rows.keys().next().value);
            }
            rows.set(word, row);
          }
        }
        return rows.get(word);
      },
      total,
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
