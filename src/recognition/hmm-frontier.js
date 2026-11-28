/** Reusable, insertion-ordered entry scores for one HMM frame. Unlicense. */

export class Frontier {
  #length = 0;

  constructor(nodeCount) {
    // Zero means absent. The other values are offsets plus one.
    this.index = new Uint16Array(nodeCount);
    this.columns = {
      nodes: new Uint32Array(256),
      scores: new Float64Array(256),
      histories: new Int32Array(256),
      starts: new Int32Array(256),
    };
  }

  get length() {
    return this.#length;
  }

  #grow(capacity) {
    for (const [name, column] of Object.entries(this.columns)) {
      const grown = new column.constructor(capacity);
      grown.set(column);
      this.columns[name] = grown;
    }
  }

  enter(node, score, history, start) {
    let { index } = this;
    const { columns } = this;
    let i = index[node] - 1;
    if (i < 0) {
      i = this.#length++;
      if (i === columns.nodes.length) {
        this.#grow(Math.min(i * 2, index.length));
      }
      if (i === 65535 && index instanceof Uint16Array) {
        // Offsets count queued nodes, which are usually a small subset of
        // the graph. Keep space for exceptionally wide custom searches.
        this.index = new Uint32Array(index);
        index = this.index;
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

  enterList(nodes, score, history, start) {
    for (let i = 0; i < nodes.length; i++) {
      this.enter(nodes[i], score, history, start);
    }
  }

  enterWeighted(nodes, weights, scale, score, history, start) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      this.enter(node, score + scale * weights[node], history, start);
    }
  }

  enterChildren(id, { child, sibling, lookLn }, scale, score, history, start) {
    const parent = scale * lookLn[id];
    for (let node = child[id]; node; node = sibling[node]) {
      this.enter(node, score + scale * lookLn[node] - parent, history, start);
    }
  }

  clear() {
    const { index, columns } = this;
    for (let i = 0; i < this.#length; i++) {
      index[columns.nodes[i]] = 0;
    }
    this.#length = 0;
  }
}
