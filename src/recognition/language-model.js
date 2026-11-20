/** Count-weighted phone statistics, derived lazily from the forward lexicons. */
import { lexiconRevision } from '../g2p/lexicon.js';
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
let readBuiltInModels;
let builtInModels;

// Optional build output for a cold file command. A user lexicon changes the
// phone statistics, so that path always derives them from the active words.
export function installLanguageModelReader(read) {
  readBuiltInModels = read;
  builtInModels = undefined;
}

export function countPronunciations(entries) {
  const keys = ['#'];
  const indices = new Map([['#', 0]]);
  const singleCounts = [];
  const pairRows = [];
  const tripleTables = [];
  let total = 0;
  const add = (table, key, count) =>
    table.set(key, (table.get(key) ?? 0) + count);
  function phoneIndex(symbol) {
    let index = indices.get(symbol);
    if (index === undefined) {
      index = keys.length;
      keys.push(symbol);
      indices.set(symbol, index);
    }
    return index;
  }
  for (const { symbols, count } of entries) {
    let a = -1;
    let b = 0;
    singleCounts[0] = (singleCounts[0] ?? 0) + count;
    total += count;
    for (let i = 0; i <= symbols.length; i++) {
      const c =
        i === symbols.length ? 0 : phoneIndex(symbols[i].symbol ?? symbols[i]);
      singleCounts[c] = (singleCounts[c] ?? 0) + count;
      add((pairRows[b] ??= new Map()), c, count);
      if (a >= 0) {
        const table = (tripleTables[a] ??= []);
        add((table[b] ??= new Map()), c, count);
      }
      total += count;
      a = b;
      b = c;
    }
  }
  const singles = new Map(singleCounts.map((count, i) => [keys[i], count]));
  const pairs = new Map();
  const triples = new Map();
  pairRows.forEach((row, b) => {
    for (const [c, count] of row) {
      pairs.set(`${keys[b]}\t${keys[c]}`, count);
    }
  });
  tripleTables.forEach((table, a) => {
    table.forEach((row, b) => {
      const prefix = `${keys[a]}\t${keys[b]}`;
      for (const [c, count] of row) {
        triples.set(`${prefix}\t${keys[c]}`, count);
      }
    });
  });
  return { singles, pairs, triples, total };
}

function* languagePronunciations(lexicon) {
  for (const { tokens, count } of lexicon.pronunciations()) {
    yield { symbols: tokens, count };
  }
}

export function getLanguageModel(language) {
  if (lexiconRevision() === 0 && readBuiltInModels) {
    builtInModels ??= readBuiltInModels() ?? new Map();
    if (builtInModels.has(language)) {
      return builtInModels.get(language);
    }
  }
  const lexicon = getLexicon(language);
  if (cached.get(language)?.lexicon !== lexicon) {
    cached.set(language, {
      lexicon,
      ...countPronunciations(languagePronunciations(lexicon)),
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
