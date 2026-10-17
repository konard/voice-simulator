/**
 * Sparse voxel model of the airways of a head for the 3D wave solver.
 *
 * The head is cut into cubes of `dx` cm. Only cubes that hold air take part
 * in the simulation: the vocal tract (a tube around its centreline, wide
 * enough for the widest vowel), the nasal tract and a shell of free air in
 * front of the face where the sound radiates. Every air cube knows which
 * tube it belongs to and its arc position along that tube, so a 1D area
 * function can open or close it at run time (see fdtd3d.js).
 *
 * Neighbouring cubes are connected by links (the faces of the grid). A link
 * exists only where air can actually flow: along a tube, between the tube
 * ends (lips, nostrils) and the free air, through the velopharyngeal port,
 * and inside the free air. Cubes on the outer surface of the free-air shell
 * get an absorbing boundary so the radiated wave leaves the domain.
 */

import { vowelTarget } from '../articulation/phones.js';
import { noseShape, tractShape } from '../articulation/tract-shape.js';
import {
  headLandmarks,
  nasalCenterline,
  tractCenterline,
} from '../geometry/centerline.js';
import { headField, sectionAxes } from '../geometry/mesh.js';
import { normalizeHeadConfig } from '../head-config.js';
import { getPhoneme } from '../ipa/inventory.js';

export const CELL_TRACT = 0;
export const CELL_NOSE = 1;
export const CELL_AIR = 2;

export const LINK_INNER = 0;
export const LINK_LIPS = 1;
export const LINK_NOSTRILS = 2;
export const LINK_VELUM = 3;

/** Radius of the free-air shell around lips and nostrils (cm). */
const RADIATION_RADIUS = 4;
/** Fine centreline spacing used to find the nearest tube point (cm). */
const PATH_STEP = 0.1;
const ENVELOPE_VOWELS = ['i', 'e', 'ɛ', 'a', 'æ', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'ʌ'];
const DIRECTIONS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Largest vowel area along the tract (relative position -> cm²). */
function tractEnvelope(head) {
  let max = null;
  for (const symbol of ENVELOPE_VOWELS) {
    const target = vowelTarget({ phoneme: getPhoneme(symbol) });
    const { areas } = tractShape(target, head);
    max ??= new Float64Array(areas.length);
    areas.forEach((area, index) => {
      max[index] = Math.max(max[index], area);
    });
  }
  const widest = 1.15 * Math.max(...max);
  return () => widest;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Tube description with per-point frames and envelope semi-axes. */
function buildTube(path, axesAt, kind) {
  const axes = new Float64Array(path.count * 2);
  for (let index = 0; index < path.count; index++) {
    const [major, minor] = axesAt((index + 0.5) / path.count);
    axes[index * 2] = major;
    axes[index * 2 + 1] = minor;
  }
  return { ...path, axes, kind };
}

/**
 * Where a point sits relative to a tube: arc position and normalised
 * elliptical radius (<= 1 means inside the envelope).
 */
function locateInTube(point, tube, margin) {
  const { points, tangents, axes, count, sectionLength } = tube;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < count; index++) {
    const offset = index * 3;
    const distance =
      (point[0] - points[offset]) ** 2 +
      (point[1] - points[offset + 1]) ** 2 +
      (point[2] - points[offset + 2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  const offset = best * 3;
  const delta = [0, 1, 2].map((axis) => point[axis] - points[offset + axis]);
  const tangent = tangents.subarray(offset, offset + 3);
  const axial =
    delta[0] * tangent[0] + delta[1] * tangent[1] + delta[2] * tangent[2];
  const arc = (best + 0.5) * sectionLength + axial;
  const normal = cross(tangent, [1, 0, 0]);
  const v = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
  const radius = Math.hypot(
    delta[0] / (axes[best * 2] + margin),
    v / (axes[best * 2 + 1] + margin)
  );
  return { arc, radius };
}

function classifyPoint(point, tubes, dx) {
  let found = null;
  for (const tube of tubes) {
    const { arc, radius } = locateInTube(point, tube, dx / 2);
    const inside = radius <= 1 && arc >= -dx / 2 && arc <= tube.length + dx / 2;
    if (inside && (!found || radius < found.radius)) {
      found = {
        kind: tube.kind,
        arc: Math.min(tube.length, Math.max(0, arc)),
        radius,
      };
    }
  }
  return found;
}

function boundingBox(tubes, centres, dx) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  const include = (point, reach) => {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], point[axis] - reach);
      high[axis] = Math.max(high[axis], point[axis] + reach);
    }
  };
  for (const tube of tubes) {
    const reach = Math.max(...tube.axes) + dx;
    for (let index = 0; index < tube.count; index++) {
      include(tube.points.subarray(index * 3, index * 3 + 3), reach);
    }
  }
  for (const centre of centres) {
    include(centre, RADIATION_RADIUS + dx);
  }
  const size = [0, 1, 2].map((axis) =>
    Math.ceil((high[axis] - low[axis]) / dx)
  );
  return { low, size };
}

function isRadiating(point, field, centres) {
  if (field(point) <= 0) {
    return false;
  }
  return centres.some(
    (centre) =>
      Math.hypot(...point.map((value, axis) => value - centre[axis])) <=
      RADIATION_RADIUS
  );
}

/** Fill the grid: -1 = solid/outside, otherwise a cell index. */
function collectCells(grid, tubes, field, centres, dx) {
  const { low, size } = grid;
  const index = new Int32Array(size[0] * size[1] * size[2]).fill(-1);
  const cells = [];
  for (let i = 0; i < size[0]; i++) {
    for (let j = 0; j < size[1]; j++) {
      for (let k = 0; k < size[2]; k++) {
        const point = [
          low[0] + (i + 0.5) * dx,
          low[1] + (j + 0.5) * dx,
          low[2] + (k + 0.5) * dx,
        ];
        const tube = classifyPoint(point, tubes, dx);
        let cell = null;
        if (tube) {
          cell = { kind: tube.kind, arc: tube.arc, point };
        } else if (isRadiating(point, field, centres)) {
          cell = { kind: CELL_AIR, arc: 0, point };
        }
        if (cell) {
          index[(i * size[1] + j) * size[2] + k] = cells.length;
          cells.push(cell);
        }
      }
    }
  }
  return { index, cells };
}

/** Link type between two neighbouring cells, or -1 for a wall. */
function linkKind(a, b, context) {
  const { dx, lengths, velumDistance } = context;
  const reach = 3 * dx;
  if (a.kind === b.kind) {
    if (a.kind === CELL_AIR || Math.abs(a.arc - b.arc) <= reach) {
      return LINK_INNER;
    }
    return -1;
  }
  const [tube, other] = a.kind === CELL_AIR ? [b, a] : [a, b];
  if (other.kind === CELL_AIR) {
    if (tube.arc < lengths[tube.kind] - reach) {
      return -1;
    }
    return tube.kind === CELL_TRACT ? LINK_LIPS : LINK_NOSTRILS;
  }
  const [oral, nasal] = a.kind === CELL_TRACT ? [a, b] : [b, a];
  if (nasal.arc <= 2 * dx && Math.abs(oral.arc - velumDistance) <= 2 * dx) {
    return LINK_VELUM;
  }
  return -1;
}

function neighbourAt(grid, index, i, j, k) {
  const { size } = grid;
  if (i >= size[0] || j >= size[1] || k >= size[2]) {
    return -2;
  }
  if (i < 0 || j < 0 || k < 0) {
    return -2;
  }
  return index[(i * size[1] + j) * size[2] + k];
}

function connect(grid, collected, context) {
  const { index, cells } = collected;
  const links = { a: [], b: [], kind: [] };
  const { size } = grid;
  for (let i = 0; i < size[0]; i++) {
    for (let j = 0; j < size[1]; j++) {
      for (let k = 0; k < size[2]; k++) {
        const from = index[(i * size[1] + j) * size[2] + k];
        if (from < 0) {
          continue;
        }
        for (const [di, dj, dk] of DIRECTIONS) {
          const to = neighbourAt(grid, index, i + di, j + dj, k + dk);
          const kind = to >= 0 ? linkKind(cells[from], cells[to], context) : -1;
          if (kind >= 0) {
            links.a.push(from);
            links.b.push(to);
            links.kind.push(kind);
          }
        }
      }
    }
  }
  return links;
}

/** Count faces of free-air cells that open to the air outside the domain. */
function openFaces(grid, collected, field, dx) {
  const { index, cells } = collected;
  const faces = new Uint8Array(cells.length);
  const { low } = grid;
  cells.forEach((cell, cellIndex) => {
    if (cell.kind !== CELL_AIR) {
      return;
    }
    const [i, j, k] = [0, 1, 2].map((axis) =>
      Math.floor((cell.point[axis] - low[axis]) / dx)
    );
    for (const [di, dj, dk] of DIRECTIONS) {
      for (const sign of [1, -1]) {
        const ni = i + di * sign;
        const nj = j + dj * sign;
        const nk = k + dk * sign;
        if (neighbourAt(grid, index, ni, nj, nk) >= 0) {
          continue;
        }
        const point = [ni, nj, nk].map(
          (value, axis) => low[axis] + (value + 0.5) * dx
        );
        if (field(point) > 0) {
          faces[cellIndex]++;
        }
      }
    }
  });
  return faces;
}

/**
 * Build the voxel model of a head.
 * @param {Record<string, number>} head
 * @param {{dx?: number}} [options] Cube size in cm (smaller = more detail).
 */
export function buildVoxelModel(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const dx = options.dx ?? 0.8;
  const length = config.vocalTractLength;
  const neutral = tractShape({}, config);
  const velumDistance =
    ((neutral.velumIndex + 0.5) / neutral.areas.length) * length;
  const nose = noseShape(config);
  const envelope = tractEnvelope(config);
  const noseMax = 1.2 * Math.max(...nose.areas);
  const tract = buildTube(
    tractCenterline(config, { sections: Math.ceil(length / PATH_STEP) }),
    (position) => sectionAxes(envelope(position), position, config),
    CELL_TRACT
  );
  const nasal = buildTube(
    nasalCenterline(config, {
      sections: Math.ceil(nose.length / PATH_STEP),
      velumDistance,
      length: nose.length,
    }),
    () => sectionAxes(noseMax, 0.5, { ...config, pharynxRatio: 1 }),
    CELL_NOSE
  );
  const tubes = [tract, nasal];
  const { lips, nostrils } = headLandmarks(config);
  const field = headField(config);
  const grid = boundingBox(tubes, [lips, nostrils], dx);
  const collected = collectCells(grid, tubes, field, [lips, nostrils], dx);
  const context = {
    dx,
    velumDistance,
    lengths: [tract.length, nasal.length],
  };
  const links = connect(grid, collected, context);
  return {
    dx,
    head: config,
    cells: collected.cells,
    links,
    openFaces: openFaces(grid, collected, field, dx),
    lengths: context.lengths,
    velumDistance,
    landmarks: { lips, nostrils },
  };
}
