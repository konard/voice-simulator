/**
 * Voxelisation of closed triangle meshes and the medial path through
 * them: the inside of a segmented vocal tract on a regular grid, the
 * distance of every inside cell to the wall, and the path from the
 * glottis to the lips that stays as far from the walls as it can (a
 * robust centreline, which does not wander into blind pouches such as
 * the closed nasopharynx because it has to reach the lips).
 */

import { boundaryLoops, loopShape, meshBounds } from './slice.js';

/**
 * Close the open boundaries of a surface with a fan of triangles around
 * each loop's centroid.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @returns {{positions: Float64Array, indices: Uint32Array}}
 */
export function capLoops(mesh) {
  const positions = Array.from(mesh.positions);
  const indices = Array.from(mesh.indices);
  for (const loop of boundaryLoops(mesh)) {
    const { center } = loopShape(mesh, loop);
    const middle = positions.length / 3;
    positions.push(...center);
    for (let index = 0; index < loop.length; index++) {
      indices.push(loop[index], loop[(index + 1) % loop.length], middle);
    }
  }
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

/**
 * Cells whose centres lie inside a closed mesh (parity of crossings of
 * rays along +z).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{dx: number, padding?: number}} options
 * @returns {{inside: Uint8Array, size: number[], origin: number[], dx: number}}
 */
export function voxelizeMesh(mesh, options) {
  const { dx } = options;
  const padding = options.padding ?? 2;
  const { min, max } = meshBounds(mesh);
  const origin = min.map((value) => value - padding * dx);
  const size = max.map(
    (value, axis) => Math.ceil((value - origin[axis]) / dx) + padding + 1
  );
  const [nx, ny, nz] = size;
  const crossings = Array.from({ length: nx * ny }, () => []);
  const { positions, indices } = mesh;
  const corner = (index) => [
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2],
  ];
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => corner(indices[index + k]));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area === 0) {
      continue;
    }
    const i0 = Math.max(
      0,
      Math.ceil((Math.min(a[0], b[0], c[0]) - origin[0]) / dx - 0.5)
    );
    const i1 = Math.min(
      nx - 1,
      Math.floor((Math.max(a[0], b[0], c[0]) - origin[0]) / dx - 0.5)
    );
    const j0 = Math.max(
      0,
      Math.ceil((Math.min(a[1], b[1], c[1]) - origin[1]) / dx - 0.5)
    );
    const j1 = Math.min(
      ny - 1,
      Math.floor((Math.max(a[1], b[1], c[1]) - origin[1]) / dx - 0.5)
    );
    for (let i = i0; i <= i1; i++) {
      const x = origin[0] + (i + 0.5) * dx + 1e-7 * dx;
      for (let j = j0; j <= j1; j++) {
        const y = origin[1] + (j + 0.5) * dx + 1.3e-7 * dx;
        const wa = (b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y);
        const wb = (c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y);
        const wc = area - wa - wb;
        if (
          (wa >= 0 && wb >= 0 && wc >= 0) ||
          (wa <= 0 && wb <= 0 && wc <= 0)
        ) {
          crossings[i * ny + j].push(
            (wa * a[2] + wb * b[2] + wc * c[2]) / area
          );
        }
      }
    }
  }
  const inside = new Uint8Array(nx * ny * nz);
  for (let column = 0; column < crossings.length; column++) {
    const list = crossings[column].sort((p, q) => p - q);
    for (let pair = 0; pair + 1 < list.length; pair += 2) {
      const k0 = Math.max(0, Math.ceil((list[pair] - origin[2]) / dx - 0.5));
      const k1 = Math.min(
        nz - 1,
        Math.floor((list[pair + 1] - origin[2]) / dx - 0.5)
      );
      for (let k = k0; k <= k1; k++) {
        inside[column * nz + k] = 1;
      }
    }
  }
  return { inside, size, origin, dx };
}

const NEIGHBOURS = [];
for (let di = -1; di <= 1; di++) {
  for (let dj = -1; dj <= 1; dj++) {
    for (let dk = -1; dk <= 1; dk++) {
      if (di || dj || dk) {
        NEIGHBOURS.push([di, dj, dk, Math.hypot(di, dj, dk)]);
      }
    }
  }
}

/** Binary heap of [cost, cell] pairs. */
class Queue {
  constructor() {
    this.items = [];
  }

  push(cost, cell) {
    const items = this.items;
    items.push([cost, cell]);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (items[parent][0] <= items[at][0]) {
        break;
      }
      [items[parent], items[at]] = [items[at], items[parent]];
      at = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let smallest = at;
        if (left < items.length && items[left][0] < items[smallest][0]) {
          smallest = left;
        }
        if (right < items.length && items[right][0] < items[smallest][0]) {
          smallest = right;
        }
        if (smallest === at) {
          break;
        }
        [items[smallest], items[at]] = [items[at], items[smallest]];
        at = smallest;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

function forEachNeighbour(cell, size, visit) {
  const [, ny, nz] = size;
  const i = Math.floor(cell / (ny * nz));
  const j = Math.floor(cell / nz) % ny;
  const k = cell % nz;
  for (const [di, dj, dk, step] of NEIGHBOURS) {
    const a = i + di;
    const b = j + dj;
    const c = k + dk;
    if (a >= 0 && b >= 0 && c >= 0 && a < size[0] && b < ny && c < nz) {
      visit((a * ny + b) * nz + c, step);
    }
  }
}

/**
 * Squared distance transform of one line of samples in place (lower
 * envelope of parabolas, Felzenszwalb and Huttenlocher 2012).
 */
function transformLine(values, count, scratch) {
  const { sites, bounds, line } = scratch;
  line.set(values.subarray(0, count));
  let hull = 0;
  sites[0] = 0;
  bounds[0] = -Infinity;
  bounds[1] = Infinity;
  const meet = (q, p) =>
    (line[q] + q * q - (line[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < count; q++) {
    if (line[q] === Infinity) {
      continue;
    }
    if (line[sites[hull]] === Infinity) {
      sites[hull] = q;
      continue;
    }
    let at = meet(q, sites[hull]);
    while (at <= bounds[hull]) {
      hull--;
      at = meet(q, sites[hull]);
    }
    hull++;
    sites[hull] = q;
    bounds[hull] = at;
    bounds[hull + 1] = Infinity;
  }
  hull = 0;
  for (let q = 0; q < count; q++) {
    while (bounds[hull + 1] < q) {
      hull++;
    }
    const p = sites[hull];
    values[q] = line[p] === Infinity ? Infinity : (q - p) ** 2 + line[p];
  }
}

/**
 * Euclidean distance (in cells) from every inside cell centre to the
 * nearest outside cell centre, by the separable exact transform.
 * @param {{inside: Uint8Array, size: number[]}} grid
 * @returns {Float32Array}
 */
export function wallDistance({ inside, size }) {
  const [nx, ny, nz] = size;
  const squared = new Float64Array(inside.length);
  for (let cell = 0; cell < inside.length; cell++) {
    squared[cell] = inside[cell] ? Infinity : 0;
  }
  const longest = Math.max(nx, ny, nz);
  const scratch = {
    sites: new Int32Array(longest),
    bounds: new Float64Array(longest + 1),
    line: new Float64Array(longest),
  };
  const values = new Float64Array(longest);
  const strides = [ny * nz, nz, 1];
  for (let axis = 0; axis < 3; axis++) {
    const stride = strides[axis];
    const count = size[axis];
    const [first, second] = [0, 1, 2].filter((other) => other !== axis);
    for (let a = 0; a < size[first]; a++) {
      for (let b = 0; b < size[second]; b++) {
        const base = a * strides[first] + b * strides[second];
        for (let k = 0; k < count; k++) {
          values[k] = squared[base + k * stride];
        }
        transformLine(values, count, scratch);
        for (let k = 0; k < count; k++) {
          squared[base + k * stride] = values[k];
        }
      }
    }
  }
  return Float32Array.from(squared, Math.sqrt);
}

/** Index of the inside cell nearest to a point. */
export function nearestInside({ inside, size, origin, dx }, point) {
  let best = -1;
  let bestDistance = Infinity;
  const [, ny, nz] = size;
  for (let cell = 0; cell < inside.length; cell++) {
    if (inside[cell]) {
      const i = Math.floor(cell / (ny * nz));
      const j = Math.floor(cell / nz) % ny;
      const k = cell % nz;
      const d = Math.hypot(
        origin[0] + (i + 0.5) * dx - point[0],
        origin[1] + (j + 0.5) * dx - point[1],
        origin[2] + (k + 0.5) * dx - point[2]
      );
      if (d < bestDistance) {
        bestDistance = d;
        best = cell;
      }
    }
  }
  return best;
}

/** Centre of a cell in mesh coordinates. */
export function cellCenter({ size, origin, dx }, cell) {
  const [, ny, nz] = size;
  return [
    origin[0] + (Math.floor(cell / (ny * nz)) + 0.5) * dx,
    origin[1] + ((Math.floor(cell / nz) % ny) + 0.5) * dx,
    origin[2] + ((cell % nz) + 0.5) * dx,
  ];
}

/**
 * Cheapest path between two points through the inside cells, where a
 * step costs its length over (distance to the wall)^power: it follows
 * the middle of the tract.
 * @param {{inside: Uint8Array, size: number[], origin: number[], dx: number}} grid
 * @param {Float32Array} distance From wallDistance().
 * @param {number[]} start
 * @param {number[]} end
 * @param {{power?: number}} [options]
 * @returns {number[][]} Cell centres from start to end.
 */
export function medialPath(grid, distance, start, end, options = {}) {
  const power = options.power ?? 2;
  const from = nearestInside(grid, start);
  const to = nearestInside(grid, end);
  const cost = new Float64Array(grid.inside.length).fill(Infinity);
  const previous = new Int32Array(grid.inside.length).fill(-1);
  const queue = new Queue();
  cost[from] = 0;
  queue.push(0, from);
  while (queue.size) {
    const [total, cell] = queue.pop();
    if (cell === to) {
      break;
    }
    if (total > cost[cell]) {
      continue;
    }
    forEachNeighbour(cell, grid.size, (other, step) => {
      if (grid.inside[other]) {
        const next = total + step / distance[other] ** power;
        if (next < cost[other]) {
          cost[other] = next;
          previous[other] = cell;
          queue.push(next, other);
        }
      }
    });
  }
  const path = [];
  for (let cell = to; cell >= 0; cell = previous[cell]) {
    path.push(cellCenter(grid, cell));
  }
  return path.reverse();
}
