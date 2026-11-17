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
  const pairs = new Map();
  const triples = new Map();
  let total = 0;
  const add = (table, key, count) =>
    table.set(key, (table.get(key) ?? 0) + count);
  for (const { symbols, count } of entries) {
    const sequence = ['#', ...symbols, '#'];
    for (let i = 0; i < sequence.length; i++) {
      add(singles, sequence[i], count);
      total += count;
      if (i >= 1) {
        add(pairs, sequence.slice(i - 1, i + 1).join('\t'), count);
      }
      if (i >= 2) {
        add(triples, sequence.slice(i - 2, i + 1).join('\t'), count);
      }
    }
  }
  return { singles, pairs, triples, total };
}

export function getLanguageModel(language) {
  const lexicon = getLexicon(language);
  if (cached.get(language)?.lexicon !== lexicon) {
    const entries = [];
    const stack = [lexicon.root];
    while (stack.length) {
      const node = stack.pop();
      for (const entry of node.entries) {
        entries.push({
          symbols: entry.tokens.map((t) => t.symbol),
          count: entry.count,
        });
      }
      stack.push(...node.children.values());
    }
    cached.set(language, { lexicon, ...countPronunciations(entries) });
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
