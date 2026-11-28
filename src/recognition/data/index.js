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

/** Adapt object rows used by source builders and fixtures. */
export function rankedWordReader(words) {
  return Array.isArray(words)
    ? {
        name: (id) => words[id]?.word,
        count: (id) => words[id]?.count,
        weight: (id) => words[id]?.prior ?? words[id]?.count,
        read: (id) => words[id],
      }
    : words;
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
  const ranked = rankedWordReader(words);
  return {
    cost(id, previous) {
      const start = offsets[id];
      const end = offsets[id + 1];
      for (let i = end - 2; i >= start; i -= 2) {
        if (pairs[i] === previous) {
          return discountedCost(pairs[i + 1], ranked.count(previous));
        }
      }
      return undefined;
    },
    row(id) {
      const start = offsets[id];
      const end = offsets[id + 1];
      if (!(start < end)) {
        return undefined;
      }
      const result = new Map();
      for (let i = start; i < end; i += 2) {
        const previous = pairs[i];
        result.set(
          ranked.name(previous),
          discountedCost(pairs[i + 1], ranked.count(previous))
        );
      }
      return result;
    },
  };
}

function wordIds(names) {
  const ids = new Map();
  for (let i = 0; i < names.length; i++) {
    ids.set(names[i], i);
  }
  return ids;
}

/** Link the encoded pairs by destination without opening their cost maps. */
function indexBigrams(source, words) {
  // The smallest record is "0,0=1", plus the space between records.
  const capacity = Math.floor((source.length + 1) / 6);
  const records = new Uint32Array(capacity * 2);
  const counts = new Float64Array(capacity);
  const heads = new Uint32Array(words.length);
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
  return {
    cost(id, previous) {
      let cost;
      let link = heads[id];
      while (link) {
        const index = link - 1;
        if (records[index * 2] === previous) {
          cost = discountedCost(counts[index], words.count(previous));
        }
        link = records[index * 2 + 1];
      }
      return cost;
    },
    row(id) {
      let link = heads[id];
      if (!link) {
        return undefined;
      }
      const result = new Map();
      while (link) {
        const index = link - 1;
        const previous = records[index * 2];
        result.set(
          words.name(previous),
          discountedCost(counts[index], words.count(previous))
        );
        link = records[index * 2 + 1];
      }
      return result;
    },
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
 * A word's `prior` is its share of the spoken-language counts scaled
 * to `total`, or 1 (never seen) when they lack it. The books behind the
 * counts never saw everyday words such as "hello", which then lost to
 * "her no" and "hollow" (issue 181).
 */
function spokenPriors(names, total, spoken) {
  const shares = new Map();
  for (const item of spoken.SPOKEN.split(' ')) {
    const at = item.lastIndexOf('=');
    if (at > 0) {
      shares.set(item.slice(0, at), Number(item.slice(at + 1)));
    }
  }
  const scale = total / spoken.SPOKEN_WORDS;
  return Float64Array.from(names, (word) =>
    Math.max(1, (shares.get(word) ?? 0) * scale)
  );
}

function parseWords(source, spoken) {
  const names = [];
  const values = [];
  let total = 0;
  let start = 0;
  while (start < source.length) {
    const separator = source.indexOf(' ', start);
    const end = separator === -1 ? source.length : separator;
    if (end > start) {
      const at = source.lastIndexOf('=', end - 1);
      const count = Number(source.slice(at + 1, end));
      names.push(source.slice(start, at));
      values.push(count);
      total += count;
    }
    start = end + 1;
  }
  const counts = Float64Array.from(values);
  const priors = spoken && spokenPriors(names, total, spoken);
  let ids;
  return {
    length: names.length,
    total,
    name: (id) => names[id],
    count: (id) => counts[id],
    weight: (id) => priors?.[id] ?? counts[id],
    rank: (word) => (ids ??= wordIds(names)).get(word),
    read(id) {
      const word = names[id];
      return word === undefined
        ? undefined
        : { word, count: counts[id], ...(priors && { prior: priors[id] }) };
    },
  };
}

export function getCounts(language) {
  if (!DATA.has(language)) {
    throw new RangeError(`unsupported recognition language "${language}"`);
  }
  if (!opened.has(language)) {
    const data = DATA.get(language);
    const ranked = parseWords(data.WORDS, SPOKEN.get(language));
    let words;
    let counts;
    let bigrams;
    let openRow;
    const rows = new Map();
    const { rank } = ranked;
    const transitions = () =>
      (openRow ??=
        readTransitions?.(language, ranked) ??
        indexBigrams(data.BIGRAMS, ranked));
    opened.set(language, {
      ranked,
      get words() {
        return (words ??= Array.from({ length: ranked.length }, (_, id) =>
          ranked.read(id)
        ));
      },
      wordCount: (word) => ranked.count(rank(word)),
      get counts() {
        if (!counts) {
          counts = new Map();
          for (let id = 0; id < ranked.length; id++) {
            counts.set(ranked.name(id), ranked.count(id));
          }
        }
        return counts;
      },
      get bigrams() {
        if (!bigrams) {
          bigrams = new Map();
          for (const [previous, next, count] of bigramRows(
            data.BIGRAMS,
            this.words
          )) {
            bigrams.set(`${previous.word}\t${next.word}`, count);
          }
        }
        return bigrams;
      },
      transitionRow(word) {
        if (!rows.has(word)) {
          const row = transitions().row(rank(word));
          if (row) {
            if (rows.size === 1024) {
              rows.delete(rows.keys().next().value);
            }
            rows.set(word, row);
          }
        }
        return rows.get(word);
      },
      transitionCost(word, previousWord) {
        return rows.has(word)
          ? rows.get(word).get(previousWord)
          : transitions().cost(rank(word), rank(previousWord));
      },
      transitionCostAt(word, previous) {
        return transitions().cost(word, previous);
      },
      total: ranked.total,
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
  const count = data.wordCount ? data.wordCount(word) : data.counts.get(word);
  const backoff = -0.3 * Math.log((0.4 * (count ?? 1)) / data.total) + 0.5;
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
