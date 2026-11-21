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
  const cache = new Map();
  function asNode(id) {
    if (!cache.has(id)) {
      const start = table.offsets[id];
      const end = table.offsets[id + 1];
      cache.set(id, {
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
      });
    }
    return cache.get(id);
  }
  return asNode(0);
}

export function openPreparedLexicon(rows, language, words) {
  const [tokens, offsets, feature, wordOffsets, ids, readings] = rows;
  const terminal = new Uint32Array(feature.length);
  for (let i = 0; i < feature.length; i++) {
    terminal[i] = Number(wordOffsets[i] < wordOffsets[i + 1]);
  }
  const parsed = new Map();
  const entries = new Map();
  function entriesAt(node) {
    if (!terminal[node]) {
      return [];
    }
    if (!entries.has(node)) {
      const group = [];
      for (let i = wordOffsets[node]; i < wordOffsets[node + 1]; i++) {
        const ipa = readings[i];
        if (!parsed.has(ipa)) {
          parsed.set(
            ipa,
            parseIpa(ipa).tokens.filter((t) => t.kind !== 'pause')
          );
        }
        group.push({ ...words[ids[i]], ipa, tokens: parsed.get(ipa) });
      }
      entries.set(node, group);
    }
    return entries.get(node);
  }
  const table = createWordTrie({
    offsets: Uint32Array.from(offsets),
    feature: Uint32Array.from(feature),
    terminal,
    tokens,
    entriesAt,
  });
  return { table, root: trieRoot(table, language) };
}
