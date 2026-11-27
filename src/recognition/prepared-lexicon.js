/** Serialize the default word trie and open it without enumerating pronunciations. Unlicense. */
import { parseIpa } from '../ipa/parse.js';
import { soundKey } from './lexicon.js';
import { createWordTrie, packWordTrie } from './word-trie.js';

// Children have consecutive breadth-first node indices. The entry rows index
// the shipped count table and keep the IPA for stress and context checks.
export function serializeLexicon(lexicon, language) {
  const trie = packWordTrie(lexicon, language);
  const words = new Map(lexicon.words.map(({ word }, i) => [word, i]));
  const offsets = [];
  const wordIds = [];
  const readings = [];
  for (let i = 0; i < trie.feature.length; i++) {
    offsets.push(readings.length);
    for (const { word, ipa } of trie.entriesAt(i)) {
      wordIds.push(words.get(word));
      readings.push(ipa);
    }
  }
  offsets.push(readings.length);
  return [
    trie.tokens,
    [...trie.offsets],
    [...trie.feature],
    offsets,
    wordIds,
    readings,
  ];
}

function trieRoot(table, language) {
  const indices = new Map(
    table.tokens.map((token, i) => [soundKey(token, language), i])
  );
  function asNode(id) {
    const start = table.offsets[id];
    const end = table.offsets[id + 1];
    return {
      token: id === 0 ? undefined : table.tokens[table.feature[id]],
      get entries() {
        return table.entriesAt(id);
      },
      children: {
        get(key) {
          const feature = indices.get(key);
          for (let i = start; i < end; i++) {
            const child = table.children[i];
            if (table.feature[child] === feature) {
              return asNode(child);
            }
          }
        },
        *values() {
          for (let i = start; i < end; i++) {
            yield asNode(table.children[i]);
          }
        },
      },
    };
  }
  return asNode(0);
}

function asUint32(values) {
  return values instanceof Uint32Array ? values : Uint32Array.from(values);
}

function entryReader(words, offsets, ids, readings, withPrior) {
  const entries = new Map();
  return (node) => {
    if (offsets[node] === offsets[node + 1]) {
      return [];
    }
    if (!entries.has(node)) {
      if (entries.size === 256) {
        entries.clear();
      }
      const group = [];
      for (let i = offsets[node]; i < offsets[node + 1]; i++) {
        const ipa = readings[i];
        const word = words[ids[i]];
        group.push({
          ...word,
          ...(withPrior && { prior: word.prior ?? word.count }),
          ipa,
          tokens: parseIpa(ipa).tokens.filter((t) => t.kind !== 'pause'),
        });
      }
      entries.set(node, group);
    }
    return entries.get(node);
  };
}

export function openPreparedLexicon(rows, language, words, withPrior = false) {
  const [tokens, offsets, feature, wordOffsets, ids, readings] = rows;
  const terminal = new Uint8Array(feature.length);
  for (let i = 0; i < feature.length; i++) {
    terminal[i] = Number(wordOffsets[i] < wordOffsets[i + 1]);
  }
  const table = createWordTrie({
    offsets: asUint32(offsets),
    feature: asUint32(feature),
    terminal,
    tokens,
    entriesAt: entryReader(
      words,
      asUint32(wordOffsets),
      asUint32(ids),
      readings,
      withPrior
    ),
  });
  return { table, root: trieRoot(table, language) };
}
