/**
 * Teeth of a model that stores a whole dental arch as one mesh, as
 * character models and the Human Reference Atlas do: the mesh is split
 * into its connected pieces (one per crown and root) and the pieces are
 * numbered from the midline back on each side, so toothLandmarks() and
 * archMeasures() measure them like the one-file-per-tooth sources.
 */

/**
 * Connected pieces of a triangle mesh. Vertices at the same position are
 * joined, so a piece split along its UV seams stays whole.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{minVertices?: number}} [options] drop smaller pieces (debris).
 * @returns {Float32Array[]} the positions of each piece.
 */
export function connectedPieces(mesh, { minVertices = 30 } = {}) {
  const { positions, indices } = mesh;
  const count = positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, index) => index);
  const find = (vertex) => {
    let root = vertex;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const join = (a, b) => {
    parent[find(a)] = find(b);
  };
  for (let at = 0; at < indices.length; at += 3) {
    join(indices[at], indices[at + 1]);
    join(indices[at], indices[at + 2]);
  }
  const seen = new Map();
  for (let vertex = 0; vertex < count; vertex++) {
    const key = `${positions[vertex * 3]},${positions[vertex * 3 + 1]},${positions[vertex * 3 + 2]}`;
    if (seen.has(key)) {
      join(vertex, seen.get(key));
    } else {
      seen.set(key, vertex);
    }
  }
  const pieces = new Map();
  for (let vertex = 0; vertex < count; vertex++) {
    const root = find(vertex);
    if (!pieces.has(root)) {
      pieces.set(root, []);
    }
    pieces.get(root).push(vertex);
  }
  return [...pieces.values()]
    .filter((vertices) => vertices.length >= minVertices)
    .map((vertices) => {
      const out = new Float32Array(vertices.length * 3);
      vertices.forEach((vertex, index) => {
        out.set(positions.subarray(vertex * 3, vertex * 3 + 3), index * 3);
      });
      return out;
    });
}

function centroid(positions) {
  const sum = [0, 0, 0];
  for (let at = 0; at < positions.length; at += 3) {
    for (let axis = 0; axis < 3; axis++) {
      sum[axis] += positions[at + axis];
    }
  }
  return sum.map((value) => value / (positions.length / 3));
}

/**
 * Number the teeth of one arch: each side from the midline back, type 0
 * (central incisor) to 6 (second molar).
 * @param {Float32Array[]} pieces tooth positions, from connectedPieces().
 * @param {'upper'|'lower'} jaw
 * @param {{lateral?: number, forward?: number, left?: number}} [axes]
 *   index of the lateral and forward axes, and the sign of the lateral
 *   axis towards the subject's left (default +x left, +z forward: glTF).
 * @returns {{jaw: string, side: 'l'|'r', type: number, positions: Float32Array}[]}
 */
export function numberTeeth(pieces, jaw, axes = {}) {
  const { lateral = 0, forward = 2, left = 1 } = axes;
  const located = pieces.map((positions) => ({
    positions,
    centre: centroid(positions),
  }));
  // The midline lies between the two most forward crowns.
  const front = [...located]
    .sort((a, b) => b.centre[forward] - a.centre[forward])
    .slice(0, 2);
  const midline =
    front.reduce((sum, tooth) => sum + tooth.centre[lateral], 0) / front.length;
  const teeth = [];
  for (const side of ['l', 'r']) {
    const sign = side === 'l' ? left : -left;
    located
      .filter((tooth) => sign * (tooth.centre[lateral] - midline) > 0)
      .sort((a, b) => b.centre[forward] - a.centre[forward])
      .slice(0, 7)
      .forEach((tooth, type) => {
        teeth.push({ jaw, side, type, positions: tooth.positions });
      });
  }
  return teeth;
}

/**
 * Lean of a tooth's long axis in the sagittal plane: the principal axis of
 * its vertices from vertical, positive when its upper end leans forward
 * (degrees). An upper incisor whose root leans back and edge forward
 * leans negative, a lower incisor with its edge forward positive.
 * @param {ArrayLike<number>} positions
 * @param {{up?: number, forward?: number}} [axes] indices of the vertical
 *   and forward axes (default y up, z forward: glTF).
 */
export function sagittalLean(positions, { up = 1, forward = 2 } = {}) {
  const count = positions.length / 3;
  let meanUp = 0;
  let meanForward = 0;
  for (let at = 0; at < positions.length; at += 3) {
    meanUp += positions[at + up] / count;
    meanForward += positions[at + forward] / count;
  }
  let upUp = 0;
  let forwardForward = 0;
  let upForward = 0;
  for (let at = 0; at < positions.length; at += 3) {
    const u = positions[at + up] - meanUp;
    const f = positions[at + forward] - meanForward;
    upUp += u * u;
    forwardForward += f * f;
    upForward += u * f;
  }
  const angle = 0.5 * Math.atan2(2 * upForward, upUp - forwardForward);
  return (angle * 180) / Math.PI;
}
