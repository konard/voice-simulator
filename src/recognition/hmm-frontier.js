/** Reusable, insertion-ordered entry scores for one HMM frame. Unlicense. */

export function createFrontier(nodeCount) {
  // Zero means absent. The other values are offsets plus one.
  const index = new Uint32Array(nodeCount);
  const nodes = [];
  const scores = [];
  const histories = [];
  const starts = [];
  let length = 0;
  return {
    nodes,
    scores,
    histories,
    starts,
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
        index[node] = i + 1;
        nodes[i] = node;
      } else if (!(score > scores[i])) {
        return;
      }
      scores[i] = score;
      histories[i] = history;
      starts[i] = start;
    },
    clear() {
      for (let i = 0; i < length; i++) {
        index[nodes[i]] = 0;
      }
      length = 0;
    },
  };
}
