/** Flat pronunciation trie and approximate-search reference. Unlicense. */
import { gapCost } from './phone-distance.js';
import { withWasmMemory } from './wasm-memory.js';
import { packWordTrie } from './word-trie.js';

function searchBuffer(size) {
  const nodes = [];
  // A beam visits only a fraction of the trie. Allocate scores as nodes enter.
  let positions = new Uint16Array(size);
  let scores = new Float64Array(Math.min(size, 256));
  let used = 0;
  function cost(node) {
    const position = positions[node];
    return position ? scores[position - 1] : Infinity;
  }
  function compare(a, b) {
    const left = scores[positions[a] - 1];
    const right = scores[positions[b] - 1];
    return left < right ? -1 : Number(left > right);
  }
  return {
    nodes,
    cost,
    offer(node, cost) {
      const position = positions[node];
      if (position) {
        if (cost < scores[position - 1]) {
          scores[position - 1] = cost;
        }
      } else if (cost < Infinity) {
        if (used === scores.length) {
          const grown = new Float64Array(Math.max(1, scores.length * 2));
          grown.set(scores);
          scores = grown;
        }
        scores[used++] = cost;
        if (used === 65536 && positions instanceof Uint16Array) {
          positions = new Uint32Array(positions);
        }
        positions[node] = used;
        nodes.push(node);
      }
    },
    prune(beam) {
      // Stable sort preserves the original traversal order on ties.
      nodes.sort(compare);
      while (nodes.length > beam) {
        positions[nodes.pop()] = 0;
      }
    },
    clear() {
      for (let i = 0; i < nodes.length; i++) {
        positions[nodes[i]] = 0;
      }
      nodes.length = 0;
      used = 0;
    },
  };
}

function insertions(table, states, next, frontier, limit, beam) {
  frontier.length = 0;
  for (let i = 0; i < states.nodes.length; i++) {
    frontier.push(states.nodes[i]);
  }
  while (frontier.length) {
    const nodes = states.nodes;
    next.clear();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      next.offer(node, states.cost(node));
    }
    const cutoff =
      nodes.length === beam ? states.cost(nodes[beam - 1]) : Infinity;
    for (let i = 0; i < frontier.length; i++) {
      const node = frontier[i];
      const cost = states.cost(node);
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
    for (let i = 0; i < next.nodes.length; i++) {
      const node = next.nodes[i];
      if (next.cost(node) < states.cost(node)) {
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
  let length = 0;
  let result = scratch.hits;
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
    for (let i = 0; i < states.nodes.length; i++) {
      const node = states.nodes[i];
      const cost = states.cost(node);
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
    for (let i = 0; i < states.nodes.length; i++) {
      const node = states.nodes[i];
      if (table.terminal[node]) {
        if (length === result.length) {
          result = new Float64Array(length * 2);
          result.set(scratch.hits);
          scratch.hits = result;
        }
        result[length++] = index - from + 1;
        result[length++] = node;
        result[length++] = states.cost(node);
      }
    }
  }
  return result.subarray(0, length);
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

// A search stays within a hard boundary. Suffix queries reuse the distances
// for that span, stored in the engine that will read them.
function distanceWindow(table, input, language, distance, allocate) {
  const stride = 1 + table.tokens.length;
  let matrix;
  let first = 0;
  let last = 0;
  function window(from, end) {
    if (!matrix || from < first || end > last) {
      const required = (end - from) * stride;
      if (!matrix || matrix.length < required) {
        const capacity = Math.min(
          input.length * stride,
          Math.max(required, (matrix?.length ?? 0) * 2)
        );
        matrix = allocate(capacity);
      }
      const values = matrix.view();
      for (let index = from; index < end; index++) {
        const token = input[index];
        const row = (index - from) * stride;
        values[row] = gapCost(token);
        for (let i = 0; i < table.tokens.length; i++) {
          values[row + 1 + i] = distance(token, table.tokens[i], language);
        }
      }
      first = from;
      last = end;
    }
    return { matrix, offset: from - first };
  }
  return { stride, window };
}

/** Consume each query's hits before making another query in the same run. */
export function withWordSearch(
  lexicon,
  input,
  language,
  distance,
  module,
  run
) {
  const table = packWordTrie(lexicon, language);
  if (!module || !table.tokens.length) {
    const scratch = { ...workspaceFor(table), hits: new Float64Array(3 * 64) };
    const { stride, window } = distanceWindow(
      table,
      input,
      language,
      distance,
      (length) => {
        const values = new Float64Array(length);
        return { length, view: () => values };
      }
    );
    return run((from, end, beam) => {
      const { matrix, offset } = window(from, end);
      const inputRows = { distances: matrix.view(), stride };
      return {
        hits: search(
          table,
          inputRows,
          offset,
          offset + end - from,
          beam,
          scratch
        ),
        entriesAt: table.entriesAt,
      };
    });
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
    const { stride, window } = distanceWindow(
      table,
      input,
      language,
      distance,
      (length) => allocate(Float64Array, length)
    );
    let out;
    return run((from, end, beam) => {
      const { matrix, offset } = window(from, end);
      const count = end - from;
      out ??= allocate(
        Float64Array,
        Math.max(1, count * Math.min(beam, 64) * 3)
      );
      const query = () =>
        (packed ?? module.exports.rec_word_search)(
          topology.pointer,
          table.nodeCount,
          gaps.pointer,
          matrix.pointer + offset * stride * Float64Array.BYTES_PER_ELEMENT,
          count,
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
