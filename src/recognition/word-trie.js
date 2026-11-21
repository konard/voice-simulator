/** Flat pronunciation trie used by the JavaScript and Rust searches. Unlicense. */
import { soundKey } from './lexicon.js';
import { gapCost } from './phone-distance.js';

const cached = new WeakMap();

export function createWordTrie({
  offsets,
  feature,
  terminal,
  tokens,
  entriesAt,
}) {
  const children = new Uint32Array(offsets.at(-1));
  for (let i = 0; i < children.length; i++) {
    children[i] = i + 1;
  }
  const topology = new Uint32Array(
    offsets.length + children.length + feature.length + terminal.length
  );
  let start = 0;
  for (const column of [offsets, children, feature, terminal]) {
    topology.set(column, start);
    start += column.length;
  }
  const tokenGaps = tokens.map(gapCost);
  const gaps = new Float64Array(feature.length);
  for (let i = 1; i < gaps.length; i++) {
    gaps[i] = tokenGaps[feature[i]];
  }
  return {
    topology,
    offsets,
    children,
    feature,
    gaps,
    terminal,
    entriesAt,
    tokens,
  };
}

function pack(lexicon, language) {
  const nodes = [lexicon.root];
  const tokens = [];
  const keys = new Map();
  const offsets = [];
  const feature = [];
  const terminal = [];
  for (const { children, entries, token } of nodes) {
    offsets.push(nodes.length - 1);
    for (const child of children.values()) {
      nodes.push(child);
    }
    if (token) {
      const key = soundKey(token, language);
      if (!keys.has(key)) {
        keys.set(key, tokens.length);
        tokens.push(token);
      }
      feature.push(keys.get(key));
    } else {
      feature.push(0);
    }
    terminal.push(Number(entries.length > 0));
  }
  offsets.push(nodes.length - 1);
  return createWordTrie({
    offsets: Uint32Array.from(offsets),
    feature: Uint32Array.from(feature),
    terminal: Uint32Array.from(terminal),
    tokens,
    entriesAt: (node) => nodes[node].entries,
  });
}

export function packWordTrie(lexicon, language) {
  if (!cached.has(lexicon)) {
    cached.set(lexicon, lexicon.prepared?.table ?? pack(lexicon, language));
  }
  return cached.get(lexicon);
}
