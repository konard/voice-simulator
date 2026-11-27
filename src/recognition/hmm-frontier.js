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
  return {
    columns,
    get length() {
      return length;
    },
    at(node) {
      return index[node] - 1;
    },
    enter(node, score, history, start) {
      let i = index[node] - 1;
      if (i < 0) {
        i = length++;
        if (i === columns.nodes.length) {
          const capacity = Math.min(i * 2, nodeCount);
          for (const [name, column] of Object.entries(columns)) {
            const grown = new column.constructor(capacity);
            grown.set(column);
            columns[name] = grown;
          }
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
