/** Serialize the default word trie and open it without enumerating pronunciations. Unlicense. */
import { parseIpa } from '../ipa/parse.js';
import { soundKey } from './lexicon.js';
import { createWordTrie, packWordTrie } from './word-trie.js';
import { rankedWordReader } from './data/index.js';

function narrow(values, max) {
  return max <= 65535 ? Uint16Array.from(values) : asIndexColumn(values);
}

function packReadings(readings) {
  const offsets = new Uint32Array(readings.length + 1);
  for (let i = 0; i < readings.length; i++) {
    offsets[i + 1] = offsets[i] + readings[i].length;
  }
  return { offsets, text: readings.join('') };
}

export function packPreparedLexicon(rows) {
  const [tokens, children, feature, offsets, wordIds, readings] = rows;
  const maxWord = wordIds.reduce((max, word) => Math.max(max, word), 0);
  return [
    tokens,
    narrow(children, feature.length - 1),
    tokens.length <= 256 ? Uint8Array.from(feature) : feature,
    narrow(offsets, readings.length),
    narrow(wordIds, maxWord),
    packReadings(readings),
  ];
}

// Children have consecutive breadth-first node indices. The entry rows index
// the shipped count table and keep the IPA for stress and context checks.
export function serializeLexicon(lexicon, language) {
  const trie = packWordTrie(lexicon, language);
  const words = new Map(lexicon.words.map(({ word }, i) => [word, i]));
  const offsets = new Uint32Array(trie.nodeCount + 1);
  const wordIds = [];
  const readings = [];
  for (let i = 0; i < trie.feature.length; i++) {
    offsets[i] = readings.length;
    for (const { word, ipa } of trie.entriesAt(i)) {
      wordIds.push(words.get(word));
      readings.push(ipa);
    }
  }
  offsets[trie.nodeCount] = readings.length;
  return packPreparedLexicon([
    trie.tokens,
    trie.offsets,
    trie.feature,
    offsets,
    wordIds,
    readings,
  ]);
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
            const child = i + 1;
            if (table.feature[child] === feature) {
              return asNode(child);
            }
          }
        },
        *values() {
          for (let i = start; i < end; i++) {
            yield asNode(i + 1);
          }
        },
      },
    };
  }
  return asNode(0);
}

function asIndexColumn(values) {
  return ArrayBuffer.isView(values) ? values : Uint32Array.from(values);
}

function readingAt(readings) {
  if (Array.isArray(readings)) {
    return (i) => readings[i];
  }
  const { offsets, text } = readings;
  return (i) => text.slice(offsets[i], offsets[i + 1]);
}

function entryReader(words, offsets, ids, readIpa, withPrior) {
  const ranked = rankedWordReader(words);
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
        const ipa = readIpa(i);
        const word = ranked.read(ids[i]);
        let tokens;
        group.push({
          ...word,
          ...(withPrior && { prior: word.prior ?? word.count }),
          ipa,
          get tokens() {
            tokens ??= parseIpa(ipa).tokens.filter((t) => t.kind !== 'pause');
            return tokens;
          },
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
    offsets: asIndexColumn(offsets),
    feature: asIndexColumn(feature),
    terminal,
    tokens,
    entriesAt: entryReader(
      words,
      asIndexColumn(wordOffsets),
      asIndexColumn(ids),
      readingAt(readings),
      withPrior
    ),
  });
  return { table, root: trieRoot(table, language) };
}
