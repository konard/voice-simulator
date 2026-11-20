/** Flat pronunciation trie and approximate-search reference. Unlicense. */
import { gapCost } from './phone-distance.js';
import { soundKey } from './lexicon.js';
import { withWasmMemory } from './wasm-memory.js';

const packed = new WeakMap();

function pack(lexicon, language) {
  if (packed.has(lexicon)) {
    return packed.get(lexicon);
  }
  const nodes = [lexicon.root];
  const tokens = [];
  const keys = new Map();
  const edges = [];
  const offsets = [];
  const feature = [];
  const gaps = [];
  const terminal = [];
  for (const node of nodes) {
    offsets.push(edges.length);
    for (const child of node.children.values()) {
      edges.push(nodes.length);
      nodes.push(child);
    }
    const token = node.token;
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
    gaps.push(token ? gapCost(token) : 0);
    terminal.push(Number(node.entries.length > 0));
  }
  offsets.push(edges.length);
  const table = {
    topology: Uint32Array.from([...offsets, ...edges, ...feature, ...terminal]),
    offsets: Uint32Array.from(offsets),
    children: Uint32Array.from(edges),
    feature: Uint32Array.from(feature),
    gaps: Float64Array.from(gaps),
    terminal: Uint32Array.from(terminal),
    entries: nodes.map(({ entries }) => entries),
    tokens,
  };
  packed.set(lexicon, table);
  return table;
}

function cheapest(states, beam) {
  const seen = new Map();
  for (const state of states) {
    if (state.cost < (seen.get(state.node)?.cost ?? Infinity)) {
      seen.set(state.node, state);
    }
  }
  return [...seen.values()].sort((a, b) => a.cost - b.cost).slice(0, beam);
}

function insertions(table, states, limit, beam) {
  let all = states;
  let frontier = states;
  while (frontier.length) {
    const next = all.slice();
    const known = new Map(all.map(({ node, cost }) => [node, cost]));
    for (const { node, cost } of frontier) {
      for (let i = table.offsets[node]; i < table.offsets[node + 1]; i++) {
        const child = table.children[i];
        const score = cost + table.gaps[child];
        if (score <= limit && score < (known.get(child) ?? Infinity)) {
          next.push({ node: child, cost: score });
        }
      }
    }
    all = cheapest(next, beam);
    frontier = all.filter(
      ({ node, cost }) => cost < (known.get(node) ?? Infinity)
    );
  }
  return all;
}

function search(table, distances, stride, from, end, beam) {
  const result = [];
  let states = insertions(table, [{ node: 0, cost: 0 }], 0.6, beam);
  for (let index = from; index < end && states.length; index++) {
    const limit = 0.6 * (index - from + 2);
    const next = [];
    const row = index * stride;
    for (const { node, cost } of states) {
      const deletion = cost + distances[row];
      if (deletion <= limit) {
        next.push({ node, cost: deletion });
      }
      for (let i = table.offsets[node]; i < table.offsets[node + 1]; i++) {
        const child = table.children[i];
        const score = cost + distances[row + 1 + table.feature[child]];
        if (score <= limit) {
          next.push({ node: child, cost: score });
        }
      }
    }
    states = insertions(table, cheapest(next, beam), limit, beam);
    for (const { node, cost } of states) {
      if (table.terminal[node]) {
        result.push(index - from + 1, node, cost);
      }
    }
  }
  return result;
}

export function withWordSearch(
  lexicon,
  input,
  language,
  distance,
  module,
  run
) {
  const table = pack(lexicon, language);
  const stride = 1 + table.tokens.length;
  const distances = new Float64Array(input.length * stride);
  for (const [index, token] of input.entries()) {
    const row = index * stride;
    distances[row] = gapCost(token);
    for (let i = 0; i < table.tokens.length; i++) {
      distances[row + 1 + i] = distance(token, table.tokens[i], language);
    }
  }
  if (!module || stride < 2) {
    return run((from, end, beam) => ({
      hits: search(table, distances, stride, from, end, beam),
      entries: table.entries,
    }));
  }
  return withWasmMemory(module, (allocate) => {
    const topology = allocate(
      Uint32Array,
      table.topology.length,
      table.topology
    );
    const gaps = allocate(Float64Array, table.gaps.length, table.gaps);
    const matrix = allocate(Float64Array, distances.length, distances);
    let out = allocate(Float64Array, Math.max(1, input.length * 16));
    return run((from, end, beam) => {
      const query = () =>
        module.exports.rec_word_search(
          topology.pointer,
          gaps.length,
          gaps.pointer,
          matrix.pointer + from * stride * 8,
          end - from,
          stride,
          beam,
          out.pointer,
          out.length
        );
      let length = query();
      if (length > out.length) {
        out = allocate(Float64Array, length);
        length = query();
      }
      if (length < 0 || length > out.length) {
        throw new Error(`Rust word search failed (${length})`);
      }
      return { hits: out.view(length), entries: table.entries };
    });
  });
}
