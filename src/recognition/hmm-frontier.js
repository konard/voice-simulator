/** Reusable, insertion-ordered entry scores for one HMM frame. Unlicense. */

export function createFrontier(nodeCount) {
  // Zero means absent. The other values are offsets plus one.
  const index = new Uint32Array(nodeCount);
  const columns = {
    nodes: new Uint32Array(256),
    scores: new Float64Array(256),
    histories: new Int32Array(256),
    starts: new Int32Array(256),
  };
  let length = 0;
  function grow(capacity) {
    for (const [name, column] of Object.entries(columns)) {
      const grown = new column.constructor(capacity);
      grown.set(column);
      columns[name] = grown;
    }
  }
  function enter(node, score, history, start) {
    let i = index[node] - 1;
    if (i < 0) {
      i = length++;
      if (i === columns.nodes.length) {
        grow(Math.min(i * 2, nodeCount));
      }
      index[node] = i + 1;
      columns.nodes[i] = node;
    } else if (!(score > columns.scores[i])) {
      return;
    }
    columns.scores[i] = score;
    columns.histories[i] = history;
    columns.starts[i] = start;
  }
  return {
    columns,
    index,
    get length() {
      return length;
    },
    enter,
    enterList(nodes, score, history, start) {
      for (let i = 0; i < nodes.length; i++) {
        enter(nodes[i], score, history, start);
      }
    },
    enterWeighted(nodes, weights, scale, score, history, start) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        enter(node, score + scale * weights[node], history, start);
      }
    },
    enterChildren(
      id,
      { child, sibling, lookLn },
      scale,
      score,
      history,
      start
    ) {
      const parent = scale * lookLn[id];
      for (let node = child[id]; node; node = sibling[node]) {
        enter(node, score + scale * lookLn[node] - parent, history, start);
      }
    },
    clear() {
      const { nodes } = columns;
      for (let i = 0; i < length; i++) {
        index[nodes[i]] = 0;
      }
      length = 0;
    },
  };
}
