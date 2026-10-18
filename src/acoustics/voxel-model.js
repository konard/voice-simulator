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
 *
 * Two pouches of the lower pharynx have tubes of their own (issue 9): the
 * piriform fossae beside the larynx tube and the vallecula in front of the
 * epiglottis (see sinuses.js). They open into the tract only at their
 * upper end, so each adds its antiresonance to every vowel.
 *
 * The free-air shell grows to reach a distant microphone (up to
 * MAX_RADIATION_RADIUS). An enclosure replaces the shell by a box of air
 * around the head whose walls reflect part of the sound, so the solver
 * simulates the reverberation of a small space (a booth, a helmet, a box).
 */

import { vowelTarget } from '../articulation/phones.js';
import { noseShape, tractShape } from '../articulation/tract-shape.js';
import {
  INCISOR_THICKNESS,
  REST_GAP,
  incisorDepth,
  teethWidth,
} from '../articulation/teeth.js';
import {
  headLandmarks,
  nasalCenterline,
  tractCenterline,
} from '../geometry/centerline.js';
import { headField, headMesh, sectionAxes } from '../geometry/mesh.js';
import { checkedNumber } from './room.js';
import { sinusTubes } from './sinuses.js';
import { normalizeHeadConfig } from '../head-config.js';
import { getPhoneme } from '../ipa/inventory.js';

export const CELL_TRACT = 0;
export const CELL_NOSE = 1;
export const CELL_AIR = 2;
/** Piriform fossae and vallecula (see sinuses.js). */
export const CELL_SINUS = 3;

export const LINK_INNER = 0;
export const LINK_LIPS = 1;
export const LINK_NOSTRILS = 2;
export const LINK_VELUM = 3;
/** Opening of a pouch into the tract (4 is the solver's radiation link). */
export const LINK_SINUS = 5;

/** Radius of the free-air shell around lips and nostrils (cm). */
const RADIATION_RADIUS = 4;
/** Largest free-air shell used to reach a distant microphone (cm). */
export const MAX_RADIATION_RADIUS = 12;
/** Most cells an enclosure may hold (memory and time grow with it). */
export const MAX_ENCLOSURE_CELLS = 300000;
const MIN_ENCLOSURE_SIZE = 10;
const MAX_ENCLOSURE_SIZE = 200;
/** Air an enclosure must leave around the lips and nostrils (cm). */
const ENCLOSURE_CLEARANCE = 1;
/** Fine centreline spacing used to find the nearest tube point (cm). */
const PATH_STEP = 0.1;
const ENVELOPE_VOWELS = ['i', 'e', 'ɛ', 'a', 'æ', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'ʌ'];
const DIRECTIONS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Outward normal of each bit of `openMasks` (+x, -x, +y, -y, +z, -z). */
export const OPEN_FACE_NORMALS = DIRECTIONS.flatMap((direction) =>
  [1, -1].map((sign) => direction.map((value) => value * sign))
);

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

/** Target spacing of the points that sample each tract cube (cm). */
const OPENING_SPACING = 0.17;
/** Shortest stretch of tract with its own opening scale (cm). */
const OPENING_BIN = 0.25;
/** Reach of the pull towards the teeth slot in front of and behind it (cm). */
export const TEETH_APPROACH = 1.5;
/**
 * Spread of the opening weights: the weight of a point falls by e for
 * every TEETH_SOFTNESS of pull, so a smaller value gathers the air closer
 * to the slot.
 */
const TEETH_SOFTNESS = 0.15;
/** Pull lost per (0.5 cm)² of distance from the teeth slot. */
const TEETH_PULL = 1;

/**
 * Pull of the air towards the slot between the incisal edges in the
 * slices around the incisors: the flow converges on the slot, so the air
 * there gathers in line with it (the slot as at rest, see teethCells).
 */
function teethPull(point, arc, teeth) {
  if (!teeth) {
    return 0;
  }
  const along = Math.abs(arc - teeth.centre) - teeth.reach;
  if (along >= TEETH_APPROACH) {
    return 0;
  }
  const taper = Math.min(1, 1 - along / TEETH_APPROACH);
  const vertical = Math.max(
    0,
    point[1] - teeth.edge,
    teeth.edge - REST_GAP - point[1]
  );
  const lateral = Math.max(0, Math.abs(point[0]) - teeth.width / 2);
  return (-TEETH_PULL * taper * (vertical ** 2 + lateral ** 2)) / 0.25;
}

/** Weights sorted from high to low and the sums of each tail. */
function sortedWeights(values) {
  const weights = Float64Array.from(values).sort().reverse();
  const tails = new Float64Array(weights.length + 1);
  for (let index = weights.length - 1; index >= 0; index--) {
    tails[index] = tails[index + 1] + weights[index];
  }
  return { weights, tails };
}

/**
 * Weighted points of a stretch sorted by weight from high to low, with
 * the sums of the shares before each point (`heads`) and of share times
 * weight from each point on (`tails`).
 */
function sortedShares(points) {
  points.sort((a, b) => b[0] - a[0]);
  const count = points.length;
  const weights = new Float64Array(count);
  const shares = new Float64Array(count);
  const heads = new Float64Array(count + 1);
  const tails = new Float64Array(count + 1);
  points.forEach(([weight, share], index) => {
    weights[index] = weight;
    shares[index] = share;
    heads[index + 1] = heads[index] + share;
  });
  for (let index = count - 1; index >= 0; index--) {
    tails[index] = tails[index + 1] + shares[index] * weights[index];
  }
  return { weights, shares, heads, tails };
}

/**
 * Opening weights w = exp(pull / TEETH_SOFTNESS) of points spread through
 * every tract cube. A section of area A fills each point to min(1, c w),
 * with the scale c of its stretch of arc chosen so the points of that
 * stretch (`sample` cm² of cross-section each) add up to A, and a cube is
 * open by the mean fill of its points (fdtd3d.js). Away from the teeth
 * every weight is 1 and the section fills evenly; around them the air
 * gathers in line with the slot between the incisal edges, so the flow
 * through the slot does not funnel in from the whole envelope (an extra
 * acoustic mass that lowers the formants). Neighbouring slices open
 * overlapping cubes, so the flow stays connected round the grid steps.
 * `cell*` hold each cube's `per` weights, `bins` those of each stretch of
 * `binLength` cm; both sorted with the sums of their tails.
 */
function openingTable(cells, tract, dx, teeth) {
  const steps = Math.max(2, Math.round(dx / OPENING_SPACING));
  const per = steps ** 3;
  const binLength = Math.max(OPENING_BIN, dx / 2);
  const bins = Math.max(1, Math.ceil(tract.length / binLength));
  const cellWeights = new Float64Array(cells.length * per);
  const cellTails = new Float64Array(cells.length * (per + 1));
  const perBin = Array.from({ length: bins }, () => []);
  const values = new Float64Array(per);
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_TRACT) {
      return;
    }
    let at = 0;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        for (let k = 0; k < steps; k++) {
          const offset = [i, j, k].map(
            (step) => ((step + 0.5) / steps - 0.5) * dx
          );
          const point = cell.point.map((value, axis) => value + offset[axis]);
          const place = locateInTube(point, tract, dx / 2);
          // Points past the glottis or the lips fill like the end slice but
          // do not add to its cross-section.
          const inside = place.arc >= 0 && place.arc <= tract.length;
          place.arc = Math.min(tract.length, Math.max(0, place.arc));
          const weight = Math.exp(
            teethPull(point, place.arc, teeth) / TEETH_SOFTNESS
          );
          values[at++] = weight;
          if (!inside) {
            continue;
          }
          // Shared between the two nearest stretches so every stretch
          // counts the same density of points whatever the grid.
          const position = Math.min(
            bins - 1,
            Math.max(0, place.arc / binLength - 0.5)
          );
          const lower = Math.floor(position);
          const part = position - lower;
          perBin[lower].push([weight, 1 - part]);
          if (part > 0) {
            perBin[Math.min(bins - 1, lower + 1)].push([weight, part]);
          }
        }
      }
    }
    const { weights, tails } = sortedWeights(values);
    cellWeights.set(weights, index * per);
    cellTails.set(tails, index * (per + 1));
  });
  const volume = (dx / steps) ** 3;
  return {
    binLength,
    bins: perBin.map(sortedShares),
    sample: volume / binLength,
    cellWeights,
    cellTails,
    per,
  };
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
  const u = delta[0] / (axes[best * 2] + margin);
  const w = v / (axes[best * 2 + 1] + margin);
  return { arc, radius: Math.hypot(u, w) };
}

function classifyPoint(point, tubes, dx) {
  let found = null;
  for (const tube of tubes) {
    const place = locateInTube(point, tube, dx / 2);
    const { arc, radius } = place;
    const inside = radius <= 1 && arc >= -dx / 2 && arc <= tube.length + dx / 2;
    if (inside && (!found || radius < found.radius)) {
      found = {
        ...place,
        kind: tube.kind,
        tube: tube.index,
        arc: Math.min(tube.length, Math.max(0, arc)),
      };
    }
  }
  return found;
}

/** Bounds of the tube centrelines, widened by `reach` (cm). */
function tubeBounds(tube, reach) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < tube.count; index++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = tube.points[index * 3 + axis];
      low[axis] = Math.min(low[axis], value - reach);
      high[axis] = Math.max(high[axis], value + reach);
    }
  }
  return { low, high };
}

function insideBounds(point, bounds) {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < bounds.low[axis] || point[axis] > bounds.high[axis]) {
      return false;
    }
  }
  return true;
}

function boundingBox(tubes, centres, dx, shape) {
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
    include(centre, shape.radius + dx);
  }
  if (shape.box) {
    include(shape.box.low, 0);
    include(shape.box.high, 0);
  }
  const size = [0, 1, 2].map((axis) =>
    Math.ceil((high[axis] - low[axis]) / dx)
  );
  return { low, size };
}

function isRadiating(point, field, centres, shape) {
  if (shape.box) {
    return insideBounds(point, shape.box) && field(point) > 0;
  }
  if (field(point) <= 0) {
    return false;
  }
  return centres.some(
    (centre) =>
      Math.hypot(...point.map((value, axis) => value - centre[axis])) <=
      shape.radius
  );
}

/** Fill the grid: -1 = solid/outside, otherwise a cell index. */
function collectCells(grid, tubes, field, centres, shape) {
  const { low, size } = grid;
  const { dx } = shape;
  // Points far from a tube cannot belong to it: skip the costly search
  // (the reach is generous, so the cells are the same as without it).
  const bounds = tubes.map((tube) =>
    tubeBounds(tube, 2 * (Math.max(...tube.axes) + dx) + tube.sectionLength)
  );
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
        const near = tubes.filter((tube, index) =>
          insideBounds(point, bounds[index])
        );
        const tube = near.length > 0 ? classifyPoint(point, near, dx) : null;
        let cell = null;
        if (tube) {
          cell = { kind: tube.kind, arc: tube.arc, point, tube: tube.tube };
        } else if (isRadiating(point, field, centres, shape)) {
          cell = { kind: CELL_AIR, arc: 0, point, tube: -1 };
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
  if (a.kind === CELL_SINUS || b.kind === CELL_SINUS) {
    return sinusLink(a, b, context);
  }
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

/** Pouch cells connect to their own pouch, and to the tract at the opening. */
function sinusLink(a, b, context) {
  const { dx, entries } = context;
  if (a.kind === b.kind) {
    return a.tube === b.tube && Math.abs(a.arc - b.arc) <= 3 * dx
      ? LINK_INNER
      : -1;
  }
  const [sinus, other] = a.kind === CELL_SINUS ? [a, b] : [b, a];
  const opening =
    other.kind === CELL_TRACT &&
    sinus.arc <= 1.5 * dx &&
    Math.abs(other.arc - entries[sinus.tube]) <= 2 * dx;
  return opening ? LINK_SINUS : -1;
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

/**
 * Count faces of free-air cells that open to the air outside the domain,
 * with a bit mask of which faces they are (see OPEN_FACE_NORMALS).
 */
function openFaces(grid, collected, field, dx) {
  const { index, cells } = collected;
  const faces = new Uint8Array(cells.length);
  const masks = new Uint8Array(cells.length);
  const { low } = grid;
  cells.forEach((cell, cellIndex) => {
    if (cell.kind !== CELL_AIR) {
      return;
    }
    const [i, j, k] = [0, 1, 2].map((axis) =>
      Math.floor((cell.point[axis] - low[axis]) / dx)
    );
    DIRECTIONS.forEach(([di, dj, dk], direction) => {
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
          masks[cellIndex] |= 1 << (direction * 2 + (sign > 0 ? 0 : 1));
        }
      }
    });
  });
  return { faces, masks };
}

/**
 * Validate an enclosure: a box of air around the head, `width` (x),
 * `height` (y) and `depth` (z) in cm, wall `absorption` (0 = rigid, 1 =
 * anechoic; 0.2 by default) and an optional `center` [x, y, z] in head
 * coordinates (cm; the centre of the head by default).
 * @param {object|null|undefined} enclosure
 * @returns {{width: number, height: number, depth: number, absorption: number, center: number[]|null}|null}
 */
export function resolveEnclosure(enclosure) {
  if (enclosure === undefined || enclosure === null || enclosure === false) {
    return null;
  }
  const [width, height, depth] = ['width', 'height', 'depth'].map((name) =>
    checkedNumber(
      enclosure[name],
      `enclosure ${name}`,
      MIN_ENCLOSURE_SIZE,
      MAX_ENCLOSURE_SIZE
    )
  );
  const absorption = checkedNumber(
    enclosure.absorption ?? 0.2,
    'enclosure absorption',
    0,
    1
  );
  const center = enclosure.center
    ? enclosure.center.map((value) =>
        checkedNumber(value, 'enclosure center', -100, 100)
      )
    : null;
  return { width, height, depth, absorption, center };
}

/** Centre of the head surface (cm). */
function headCenter(head) {
  const { positions } = headMesh(head, { lod: 0 });
  return [0, 1, 2].map((axis) => {
    let low = Infinity;
    let high = -Infinity;
    for (let index = axis; index < positions.length; index += 3) {
      low = Math.min(low, positions[index]);
      high = Math.max(high, positions[index]);
    }
    return (low + high) / 2;
  });
}

/**
 * Corners of an enclosure around a head (cm), with the lips position.
 * @param {Record<string, number>} head
 * @param {object} enclosure Enclosure option (see resolveEnclosure).
 * @returns {{low: number[], high: number[], lips: number[], absorption: number}|null}
 */
export function enclosureBounds(head, enclosure) {
  const resolved = resolveEnclosure(enclosure);
  if (!resolved) {
    return null;
  }
  const config = normalizeHeadConfig(head);
  const center = resolved.center ?? headCenter(config);
  const size = [resolved.width, resolved.height, resolved.depth];
  const low = center.map((value, axis) => value - size[axis] / 2);
  const high = center.map((value, axis) => value + size[axis] / 2);
  const { lips, nostrils } = headLandmarks(config);
  for (const point of [lips, nostrils]) {
    const inside = point.every(
      (value, axis) =>
        value - ENCLOSURE_CLEARANCE >= low[axis] &&
        value + ENCLOSURE_CLEARANCE <= high[axis]
    );
    if (!inside) {
      throw new Error('The enclosure must contain the lips and the nostrils');
    }
  }
  return { low, high, lips, absorption: resolved.absorption };
}

/**
 * Radius of the free-air shell that reaches a microphone (cm).
 * @param {{distance?: number}|null|undefined} microphone
 * @param {number} dx
 */
export function radiationRadius(microphone, dx) {
  if (!microphone) {
    return RADIATION_RADIUS;
  }
  const distance = microphone.distance ?? 3;
  // Keep two cells of air beyond the microphone: the boundary right next
  // to it would lower the level.
  return Math.min(
    MAX_RADIATION_RADIUS,
    Math.max(RADIATION_RADIUS, distance + 2 * dx)
  );
}

/**
 * Options of buildVoxelModel for render options (dx, microphone,
 * enclosure, pouches), e.g. to build or cache a model once for many
 * utterances.
 * @param {{dx?: number, microphone?: object, enclosure?: object, piriform?: boolean, vallecula?: boolean}} options
 */
export function voxelModelOptions(options = {}) {
  const dx = options.dx ?? 0.8;
  const result = { dx };
  if (options.microphone) {
    result.radiationRadius = radiationRadius(options.microphone, dx);
  }
  if (options.enclosure) {
    result.enclosure = resolveEnclosure(options.enclosure);
  }
  for (const pouch of ['piriform', 'vallecula']) {
    if (options[pouch] === false) {
      result[pouch] = false;
    }
  }
  return result;
}

/** Normal-incidence wall admittance for an absorption coefficient. */
function wallAdmittance(absorption) {
  const reflection = Math.sqrt(1 - absorption);
  return (1 - reflection) / (1 + reflection);
}

/**
 * Tract cells in the incisor slices. They become solid tooth or stay air
 * depending on the incisor gap (see Fdtd3d#applyTeeth). The upper incisal
 * edge is fixed to the skull; the lower edge drops with the jaw.
 */
function teethCells(cells, config, length, lips, dx) {
  const centre = length - incisorDepth(config) - INCISOR_THICKNESS / 2;
  const reach = Math.max(dx, INCISOR_THICKNESS) / 2;
  const members = [];
  const groups = [];
  cells.forEach((cell, index) => {
    if (cell.kind === CELL_TRACT && Math.abs(cell.arc - centre) <= reach) {
      members.push(index);
      groups.push(Math.round(cell.arc / dx));
    }
  });
  return {
    cells: Int32Array.from(members),
    groups: Int32Array.from(groups),
    centre,
    reach,
    edge: lips[1] + REST_GAP / 2,
    width: teethWidth(config),
  };
}

/**
 * Build the voxel model of a head.
 * @param {Record<string, number>} head
 * @param {{dx?: number, radiationRadius?: number, enclosure?: object, piriform?: boolean, vallecula?: boolean}} [options]
 *   Cube size in cm (smaller = more detail), radius of the free-air shell
 *   around lips and nostrils (cm, 4 by default) or an enclosure (see
 *   resolveEnclosure) that replaces the shell. `piriform: false` and
 *   `vallecula: false` leave out the pouches.
 */
export function buildVoxelModel(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const dx = options.dx ?? 0.8;
  const radius = checkedNumber(
    options.radiationRadius ?? RADIATION_RADIUS,
    'radiationRadius',
    dx,
    MAX_RADIATION_RADIUS
  );
  const box = enclosureBounds(config, options.enclosure);
  if (box) {
    const cells = [0, 1, 2].reduce(
      (product, axis) =>
        product * Math.ceil((box.high[axis] - box.low[axis]) / dx),
      1
    );
    if (cells > MAX_ENCLOSURE_CELLS) {
      throw new Error(
        `The enclosure needs ${cells} cells at dx ${dx} (at most ${MAX_ENCLOSURE_CELLS}): use a smaller box or a larger dx`
      );
    }
  }
  const shape = { dx, radius, box };
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
  const sinuses = sinusTubes(tract, config, dx, options);
  const tubes = [
    tract,
    nasal,
    ...sinuses.map((tube) => ({ ...tube, kind: CELL_SINUS })),
  ];
  tubes.forEach((tube, index) => {
    tube.index = index;
  });
  const { lips, nostrils } = headLandmarks(config);
  const field = headField(config);
  const grid = boundingBox(tubes, [lips, nostrils], dx, shape);
  const collected = collectCells(grid, tubes, field, [lips, nostrils], shape);
  const context = {
    dx,
    velumDistance,
    lengths: [tract.length, nasal.length],
    entries: tubes.map((tube) => tube.entry ?? 0),
  };
  const links = connect(grid, collected, context);
  const teeth = teethCells(collected.cells, config, length, lips, dx);
  const open = openFaces(grid, collected, field, dx);
  return {
    dx,
    head: config,
    opening: openingTable(collected.cells, tract, dx, teeth),
    cells: collected.cells,
    links,
    openFaces: open.faces,
    openMasks: open.masks,
    // Admittance of each open face: 1 lets the wave leave the domain,
    // enclosure walls reflect part of it.
    boundaryAdmittance: box ? wallAdmittance(box.absorption) : 1,
    radiationRadius: box ? null : radius,
    enclosure: box,
    lengths: context.lengths,
    // Pouch tubes: tube index (as in cell.tube), name, opening arc on the
    // tract, depth (cm) and cross-section (cm²).
    sinuses: sinuses.map((tube, index) => ({
      tube: index + 2,
      name: tube.name,
      entry: tube.entry,
      length: tube.length,
      area: tube.area,
    })),
    velumDistance,
    landmarks: { lips, nostrils },
    teeth,
  };
}
