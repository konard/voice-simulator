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

class TrieNode {
  constructor(table, indices, id) {
    this.table = table;
    this.indices = indices;
    this.id = id;
  }

  get token() {
    const { table, id } = this;
    return id === 0 ? undefined : table.tokens[table.feature[id]];
  }

  get entries() {
    return this.table.entriesAt(this.id);
  }

  get children() {
    return this;
  }

  get(key) {
    const child = this.childId(this.id, key);
    if (child !== 0) {
      return new TrieNode(this.table, this.indices, child);
    }
  }

  childId(id, key) {
    const { offsets, feature } = this.table;
    const wanted = this.indices.get(key);
    for (let child = offsets[id] + 1; child <= offsets[id + 1]; child++) {
      if (feature[child] === wanted) {
        return child;
      }
    }
    return 0;
  }

  *values() {
    const { table, indices, id } = this;
    for (let i = table.offsets[id]; i < table.offsets[id + 1]; i++) {
      yield new TrieNode(table, indices, i + 1);
    }
  }
}

function trieRoot(table, language) {
  const indices = new Map(
    table.tokens.map((token, i) => [soundKey(token, language), i])
  );
  return new TrieNode(table, indices, 0);
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

const parsedTokens = new WeakMap();
const tokensProperty = {
  enumerable: true,
  configurable: true,
  get() {
    let tokens = parsedTokens.get(this);
    if (tokens === undefined) {
      tokens = parseIpa(this.ipa).tokens.filter(
        (token) => token.kind !== 'pause'
      );
      parsedTokens.set(this, tokens);
    }
    return tokens;
  },
};

function readEntry(ranked, id, ipa, withPrior) {
  let entry;
  if (ranked.prior) {
    const word = ranked.name(id);
    const count = ranked.count(id);
    const prior = ranked.prior(id);
    entry = { word, count };
    if (withPrior || prior !== undefined) {
      entry.prior = prior ?? count;
    }
    entry.ipa = ipa;
  } else {
    const word = ranked.read(id);
    entry = {
      ...word,
      ...(withPrior && { prior: word.prior ?? word.count }),
      ipa,
    };
  }
  return Object.defineProperty(entry, 'tokens', tokensProperty);
}

function entryReader(words, offsets, ids, readIpa, withPrior) {
  const ranked = rankedWordReader(words);
  const entries = new Map();
  return (node) => {
    if (offsets[node] === offsets[node + 1]) {
      return [];
    }
    const cached = entries.get(node);
    if (cached) {
      return cached;
    }
    if (entries.size === 256) {
      entries.clear();
    }
    const group = [];
    for (let i = offsets[node]; i < offsets[node + 1]; i++) {
      group.push(readEntry(ranked, ids[i], readIpa(i), withPrior));
    }
    entries.set(node, group);
    return group;
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
