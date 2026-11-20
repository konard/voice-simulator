/** Count-weighted phone statistics, derived lazily from the forward lexicons. */
import { getLexicon } from './lexicon.js';

// Final calibration on the 40 sentences, 8,000 words and 12 mixed fixtures:
// trigram/bigram/unigram 0.6/0.3/0.1, unigram floor
// 0.0001; tones +3, switch 6 (half at pauses), lexical gap 0.5/sound.
export const LANGUAGE_MODEL = {
  trigram: 0.6,
  bigram: 0.3,
  unigram: 0.1,
  floor: 0.0001,
  tone: 3,
  switchPenalty: 6,
  lexicalGap: 0.5,
};
const cached = new Map();

export function countPronunciations(entries) {
  const singles = new Map();
  const pairRows = new Map();
  const tripleTables = new Map();
  let total = 0;
  const add = (table, key, count) =>
    table.set(key, (table.get(key) ?? 0) + count);
  const children = (table, key) => {
    let found = table.get(key);
    if (!found) {
      found = new Map();
      table.set(key, found);
    }
    return found;
  };
  for (const { symbols, count } of entries) {
    let a;
    let b = '#';
    add(singles, b, count);
    total += count;
    for (let i = 0; i <= symbols.length; i++) {
      const c = i === symbols.length ? '#' : (symbols[i].symbol ?? symbols[i]);
      add(singles, c, count);
      add(children(pairRows, b), c, count);
      if (a !== undefined) {
        add(children(children(tripleTables, a), b), c, count);
      }
      total += count;
      a = b;
      b = c;
    }
  }
  const pairs = new Map();
  const triples = new Map();
  for (const [b, row] of pairRows) {
    for (const [c, count] of row) {
      pairs.set(`${b}\t${c}`, count);
    }
  }
  for (const [a, table] of tripleTables) {
    for (const [b, row] of table) {
      const prefix = `${a}\t${b}`;
      for (const [c, count] of row) {
        triples.set(`${prefix}\t${c}`, count);
      }
    }
  }
  return { singles, pairs, triples, total };
}

function* triePronunciations(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    for (const { tokens, count } of node.entries) {
      yield { symbols: tokens, count };
    }
    stack.push(...node.children.values());
  }
}

export function getLanguageModel(language) {
  const lexicon = getLexicon(language);
  if (cached.get(language)?.lexicon !== lexicon) {
    cached.set(language, {
      lexicon,
      ...countPronunciations(triePronunciations(lexicon.root)),
    });
  }
  return cached.get(language);
}

export function phoneProbability(model, a, b, c) {
  const pair = `${a}\t${b}`;
  return (
    (LANGUAGE_MODEL.trigram * (model.triples.get(`${pair}\t${c}`) ?? 0)) /
      (model.pairs.get(pair) || Infinity) +
    (LANGUAGE_MODEL.bigram * (model.pairs.get(`${b}\t${c}`) ?? 0)) /
      (model.singles.get(b) || Infinity) +
    LANGUAGE_MODEL.unigram *
      Math.max(
        (model.singles.get(c) ?? 0) / (model.total || 1),
        LANGUAGE_MODEL.floor
      )
  );
}

/** Strict comparison keeps ties stable in the caller's language order. */
export function languagePath(units, languages, penalty) {
  const backs = [];
  let previous = languages.map(() => 0);
  for (const unit of units) {
    const back = [];
    const next = languages.map((language, i) => {
      let value = previous[i];
      back[i] = i;
      for (let j = 0; j < languages.length; j++) {
        const change = previous[j] - penalty * (unit.pause ? 0.5 : 1);
        if (j !== i && change > value) {
          value = change;
          back[i] = j;
        }
      }
      return value + unit.scores[language];
    });
    backs.push(back);
    previous = next;
  }
  let at = previous.indexOf(Math.max(...previous));
  const path = Array(units.length);
  for (let u = units.length - 1; u >= 0; u--) {
    path[u] = languages[at];
    at = backs[u][at];
  }
  const original = [...path];
  for (let u = 1; u + 1 < path.length; u++) {
    if (
      original[u - 1] === original[u + 1] &&
      original[u] !== original[u - 1]
    ) {
      path[u] = original[u - 1];
    }
  }
  return path;
}
