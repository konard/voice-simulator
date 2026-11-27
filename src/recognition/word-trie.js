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
  const tokenGaps = tokens.map(gapCost);
  return {
    get nodeCount() {
      return feature.length;
    },
    writeTopology(target) {
      target.set(offsets);
      for (let i = 1; i < feature.length; i++) {
        target[offsets.length + i - 1] = i;
      }
      target.set(feature, 2 * feature.length);
      target.set(terminal, 3 * feature.length);
    },
    writeGaps(target) {
      target[0] = 0;
      for (let i = 1; i < feature.length; i++) {
        target[i] = tokenGaps[feature[i]];
      }
    },
    offsets,
    feature,
    tokenGaps,
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
