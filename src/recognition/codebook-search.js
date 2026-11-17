/** Bounded k-d search with scratch memory owned by each codebook. */
import { envelopeKey } from './codebook-features.js';

/** Nodes: row, split dimension, left, right; root is node zero. */
export function buildTree(key, size) {
  const tree = new Int32Array(size * 4).fill(-1);
  const rows = Array.from({ length: size }, (_, i) => i);
  let next = 0;
  function branch(from, to) {
    if (from === to) {
      return -1;
    }
    let dimension = 0,
      spread = -1;
    for (let d = 0; d < 6; d++) {
      let low = Infinity,
        high = -Infinity;
      for (let i = from; i < to; i++) {
        const v = key[rows[i] * 6 + d];
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      if (high - low > spread) {
        spread = high - low;
        dimension = d;
      }
    }
    const sorted = rows
      .slice(from, to)
      .sort((a, b) => key[a * 6 + dimension] - key[b * 6 + dimension] || a - b);
    for (let i = from; i < to; i++) {
      rows[i] = sorted[i - from];
    }
    const middle = (from + to) >>> 1,
      node = next++;
    tree[node * 4] = rows[middle];
    tree[node * 4 + 1] = dimension;
    tree[node * 4 + 2] = branch(from, middle);
    tree[node * 4 + 3] = branch(middle + 1, to);
    return node;
  }
  branch(0, size);
  return tree;
}

export function envelopeCost(envelope, stored, row) {
  let sum = 0,
    count = 0;
  for (let i = 0; i < 24; i++) {
    if (Number.isFinite(envelope[i])) {
      const delta = envelope[i] - (stored[row * 24 + i] * 0.5 - 64);
      sum += delta * delta;
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

/** Attach one allocation-free query closure; out arrays are caller-owned. */
// The closure owns its heap, branch bounds and reranking scratch.
// eslint-disable-next-line max-lines-per-function
export function attachQuery(book) {
  const { tree, key, envelope: stored } = book;
  const queryKey = new Float64Array(6);
  const indices = new Int32Array(64),
    distances = new Float64Array(64);
  const stack = new Int32Array(64),
    bounds = new Float64Array(64);
  const axisBounds = new Float64Array(64 * 6);
  const bands = new Uint8Array(24),
    levels = new Float64Array(24);
  // Keep scratch and heap updates local on the allocation-free frame path.
  /* eslint-disable max-statements, complexity, max-lines-per-function */
  book.query = (envelope, k = 16, out) => {
    if (
      !envelope ||
      envelope.length !== 24 ||
      !Number.isInteger(k) ||
      k < 1 ||
      k > 64 ||
      !out ||
      out.index.length < k ||
      out.cost.length < k
    ) {
      throw new RangeError(
        'query needs 24 bands, k in 1..64 and output arrays of length k'
      );
    }
    let present = 0;
    for (let i = 0; i < 24; i++) {
      if (Number.isFinite(envelope[i])) {
        bands[present] = i;
        levels[present++] = envelope[i] * 2 + 128;
      } else if (!Number.isNaN(envelope[i])) {
        throw new RangeError('Envelope contains infinity');
      }
    }
    out.index.fill(-1, 0, k);
    out.cost.fill(Infinity, 0, k);
    if (!present) {
      return out;
    }
    envelopeKey(envelope, queryKey);
    let count = 0,
      visits = 0,
      pending = 1;
    stack[0] = 0;
    bounds[0] = 0;
    axisBounds.fill(0, 0, 6);
    while (pending && visits < 192) {
      const slot = --pending;
      const node = stack[slot];
      const lowerBound = bounds[slot];
      if (count === 64 && bounds[slot] > distances[0]) {
        continue;
      }
      const row = tree[node * 4],
        d = tree[node * 4 + 1];
      const offset = row * 6;
      const d0 = queryKey[0] - key[offset],
        d1 = queryKey[1] - key[offset + 1],
        d2 = queryKey[2] - key[offset + 2],
        d3 = queryKey[3] - key[offset + 3],
        d4 = queryKey[4] - key[offset + 4],
        d5 = queryKey[5] - key[offset + 5];
      const distance =
        d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5;
      visits++;
      // Max heap: the least promising of the 64 keys is at the root.
      if (count < 64) {
        let at = count++;
        while (at > 0) {
          const parent = (at - 1) >>> 1;
          if (
            distances[parent] > distance ||
            (distances[parent] === distance && indices[parent] > row)
          ) {
            break;
          }
          distances[at] = distances[parent];
          indices[at] = indices[parent];
          at = parent;
        }
        distances[at] = distance;
        indices[at] = row;
      } else if (
        distance < distances[0] ||
        (distance === distances[0] && row < indices[0])
      ) {
        let at = 0;
        while (at * 2 + 1 < count) {
          let child = at * 2 + 1;
          if (
            child + 1 < count &&
            (distances[child + 1] > distances[child] ||
              (distances[child + 1] === distances[child] &&
                indices[child + 1] > indices[child]))
          ) {
            child++;
          }
          if (
            distances[child] < distance ||
            (distances[child] === distance && indices[child] < row)
          ) {
            break;
          }
          distances[at] = distances[child];
          indices[at] = indices[child];
          at = child;
        }
        distances[at] = distance;
        indices[at] = row;
      }
      const delta = queryKey[d] - key[row * 6 + d];
      const near = tree[node * 4 + (delta <= 0 ? 2 : 3)];
      const far = tree[node * 4 + (delta <= 0 ? 3 : 2)];
      // Preserve this node's bounds while the pending slots are overwritten.
      const oldAxis = axisBounds[slot * 6 + d];
      const farAxis = Math.max(oldAxis, delta * delta);
      if (far >= 0) {
        stack[pending] = far;
        bounds[pending] = lowerBound + farAxis - oldAxis;
        for (let j = 0; j < 6; j++) {
          axisBounds[pending * 6 + j] = axisBounds[slot * 6 + j];
        }
        axisBounds[pending * 6 + d] = farAxis;
        pending++;
      }
      if (near >= 0) {
        stack[pending] = near;
        bounds[pending] = lowerBound;
        // The far slot may be the popped slot; restore the near axis.
        for (let j = 0; j < 6; j++) {
          axisBounds[pending * 6 + j] = axisBounds[slot * 6 + j];
        }
        axisBounds[pending * 6 + d] = oldAxis;
        pending++;
      }
    }
    for (let j = 0; j < count; j++) {
      const row = indices[j];
      let sum = 0;
      const offset = row * 24;
      if (present === 24) {
        for (let band = 0; band < 24; band++) {
          const difference = levels[band] - stored[offset + band];
          sum += difference * difference;
        }
      } else {
        for (let band = 0; band < present; band++) {
          const difference = levels[band] - stored[offset + bands[band]];
          sum += difference * difference;
        }
      }
      const cost = (sum * 0.25) / present;
      let at = k - 1;
      if (
        cost > out.cost[at] ||
        (cost === out.cost[at] && row >= out.index[at])
      ) {
        continue;
      }
      while (
        at > 0 &&
        (cost < out.cost[at - 1] ||
          (cost === out.cost[at - 1] && row < out.index[at - 1]))
      ) {
        out.cost[at] = out.cost[at - 1];
        out.index[at] = out.index[at - 1];
        at--;
      }
      out.cost[at] = cost;
      out.index[at] = row;
    }
    return out;
  };
  /* eslint-enable max-statements, complexity, max-lines-per-function */
  return book;
}
