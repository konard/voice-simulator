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
  return {
    columns,
    index,
    get length() {
      return length;
    },
    enter(node, score, history, start) {
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
