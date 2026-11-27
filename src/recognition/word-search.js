/** Flat pronunciation trie and approximate-search reference. Unlicense. */
import { gapCost } from './phone-distance.js';
import { withWasmMemory } from './wasm-memory.js';
import { packWordTrie } from './word-trie.js';

function searchBuffer(size) {
  const nodes = [];
  const costs = new Float64Array(size).fill(Infinity);
  const compare = (a, b) => costs[a] - costs[b];
  return {
    nodes,
    costs,
    offer(node, cost) {
      if (cost < costs[node]) {
        if (costs[node] === Infinity) {
          nodes.push(node);
        }
        costs[node] = cost;
      }
    },
    prune(beam) {
      // Stable sort preserves the original traversal order on ties.
      nodes.sort(compare);
      while (nodes.length > beam) {
        costs[nodes.pop()] = Infinity;
      }
    },
    clear() {
      for (const node of nodes) {
        costs[node] = Infinity;
      }
      nodes.length = 0;
    },
  };
}

function insertions(table, states, next, frontier, limit, beam) {
  frontier.length = 0;
  for (const node of states.nodes) {
    frontier.push(node);
  }
  while (frontier.length) {
    next.clear();
    for (const node of states.nodes) {
      next.offer(node, states.costs[node]);
    }
    const cutoff =
      states.nodes.length === beam
        ? states.costs[states.nodes[beam - 1]]
        : Infinity;
    for (const node of frontier) {
      const cost = states.costs[node];
      for (let i = table.offsets[node]; i < table.offsets[node + 1]; i++) {
        const child = i + 1;
        const score = cost + table.tokenGaps[table.feature[child]];
        if (score <= limit && score < cutoff) {
          next.offer(child, score);
        }
      }
    }
    next.prune(beam);
    frontier.length = 0;
    for (const node of next.nodes) {
      if (next.costs[node] < states.costs[node]) {
        frontier.push(node);
      }
    }
    const previous = states;
    states = next;
    next = previous;
  }
  return states;
}

function search(table, { distances, stride }, from, end, beam, scratch) {
  const result = [];
  const { a, b, frontier } = scratch;
  a.clear();
  b.clear();
  a.offer(0, 0);
  let states = insertions(table, a, b, frontier, 0.6, beam);
  for (let index = from; index < end && states.nodes.length; index++) {
    const limit = 0.6 * (index - from + 2);
    const next = states === a ? b : a;
    next.clear();
    const row = index * stride;
    for (const node of states.nodes) {
      const cost = states.costs[node];
      const deletion = cost + distances[row];
      if (deletion <= limit) {
        next.offer(node, deletion);
      }
      for (let i = table.offsets[node]; i < table.offsets[node + 1]; i++) {
        const child = i + 1;
        const score = cost + distances[row + 1 + table.feature[child]];
        if (score <= limit) {
          next.offer(child, score);
        }
      }
    }
    next.prune(beam);
    states = insertions(table, next, states, frontier, limit, beam);
    for (const node of states.nodes) {
      if (table.terminal[node]) {
        result.push(index - from + 1, node, states.costs[node]);
      }
    }
  }
  return result;
}

const searchWorkspaces = new WeakMap();

function workspaceFor(table) {
  if (!searchWorkspaces.has(table)) {
    searchWorkspaces.set(table, {
      a: searchBuffer(table.nodeCount),
      b: searchBuffer(table.nodeCount),
      frontier: [],
    });
  }
  return searchWorkspaces.get(table);
}

export function withWordSearch(
  lexicon,
  input,
  language,
  distance,
  module,
  run
) {
  const table = packWordTrie(lexicon, language);
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
    const scratch = workspaceFor(table);
    const inputRows = { distances, stride };
    return run((from, end, beam) => ({
      hits: search(table, inputRows, from, end, beam, scratch),
      entriesAt: table.entriesAt,
    }));
  }
  return withWasmMemory(module, (allocate) => {
    const packed = module.exports.rec_word_search_packed;
    const topology = allocate(
      Uint32Array,
      packed ? table.nodeCount * 2 + 1 : table.nodeCount * 4
    );
    const gaps = packed
      ? allocate(Float64Array, table.tokenGaps.length, table.tokenGaps)
      : allocate(Float64Array, table.nodeCount);
    if (packed) {
      table.writePackedTopology(topology.view());
    } else {
      table.writeTopology(topology.view());
      table.writeGaps(gaps.view());
    }
    const matrix = allocate(Float64Array, distances.length, distances);
    let out;
    return run((from, end, beam) => {
      out ??= allocate(
        Float64Array,
        Math.max(1, input.length * Math.min(beam, 64) * 3)
      );
      const query = () =>
        (packed ?? module.exports.rec_word_search)(
          topology.pointer,
          table.nodeCount,
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
      return { hits: out.view(length), entriesAt: table.entriesAt };
    });
  });
}
