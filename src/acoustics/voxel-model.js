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
  teethWidth,
} from '../articulation/teeth.js';
import {
  headLandmarks,
  incisorFrame,
  nasalCenterline,
  tractCenterline,
} from '../geometry/centerline.js';
import {
  noseAxes,
  headField,
  headMesh,
  sectionAxes,
} from '../geometry/mesh.js';
import { checkedNumber } from './room.js';
import { pouchShift, sinusTubes } from './sinuses.js';
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
/**
 * Most cells an enclosure may hold (memory and time grow with it): enough
 * for a 30 x 44 x 30 cm box at the 0.4 cm reference tier.
 */
export const MAX_ENCLOSURE_CELLS = 700000;
const MIN_ENCLOSURE_SIZE = 10;
const MAX_ENCLOSURE_SIZE = 200;
/** Air an enclosure must leave around the lips and nostrils (cm). */
const ENCLOSURE_CLEARANCE = 1;
/** Fine centreline spacing used to find the nearest tube point (cm). */
const PATH_STEP = 0.1;
/**
 * The tract tube goes on below the glottis, straight down along its first
 * section, by this share of the rest length (issue 40): a lower larynx
 * moves the source plane of the 3D solver into it (see Fdtd3d#setGlottis).
 */
export const LARYNX_TRAVEL = 0.25;
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
function teethPull(point, teeth) {
  if (!teeth) {
    return 0;
  }
  const along = Math.abs(point[2] - teeth.plane) - teeth.reach;
  if (along >= TEETH_APPROACH) {
    return 0;
  }
  const taper = Math.min(1, 1 - along / TEETH_APPROACH);
  const vertical = Math.max(
    0,
    point[1] - teeth.edge,
    teeth.edge - teeth.restGap - point[1]
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
  // The stretches start below the glottis, where the larynx moves to, on
  // the same raster as the rest tube.
  const origin = -Math.ceil(-(tract.start ?? 0) / binLength - 1e-9) * binLength;
  const bins = Math.max(1, Math.ceil((tract.length - origin) / binLength));
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
          // Points past the end of the tube or the lips fill like the end
          // slice but do not add to its cross-section.
          const start = tract.start ?? 0;
          const inside = place.arc >= start && place.arc <= tract.length;
          const weight = Math.exp(teethPull(point, teeth) / TEETH_SOFTNESS);
          values[at++] = weight;
          if (!inside) {
            continue;
          }
          // Shared between the two nearest stretches so every stretch
          // counts the same density of points whatever the grid.
          const position = Math.min(
            bins - 1,
            Math.max(0, (place.arc - origin) / binLength - 0.5)
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
    origin,
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
 * The tube continued straight on before its first point by at least
 * `travel` cm, along the first tangent with the first cross-section.
 * `start` is the arc (negative) where the continued tube begins.
 */
function extendTube(tube, travel) {
  const { sectionLength } = tube;
  const extra = Math.ceil(travel / sectionLength - 1e-9);
  const count = tube.count + extra;
  const points = new Float64Array(count * 3);
  const tangents = new Float64Array(count * 3);
  const axes = new Float64Array(count * 2);
  points.set(tube.points, extra * 3);
  tangents.set(tube.tangents, extra * 3);
  axes.set(tube.axes, extra * 2);
  for (let index = 0; index < extra; index++) {
    const distance = (extra - index) * sectionLength;
    for (let axis = 0; axis < 3; axis++) {
      const tangent = tube.tangents[axis];
      points[index * 3 + axis] = tube.points[axis] - tangent * distance;
      tangents[index * 3 + axis] = tangent;
    }
    axes[index * 2] = tube.axes[0];
    axes[index * 2 + 1] = tube.axes[1];
  }
  return {
    ...tube,
    points,
    tangents,
    axes,
    count,
    start: -extra * sectionLength,
  };
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
  const arc = (best + 0.5) * sectionLength + axial + (tube.start ?? 0);
  const normal = cross(tangent, [1, 0, 0]);
  const v = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
  const u = delta[0] / (axes[best * 2] + margin);
  const w = v / (axes[best * 2 + 1] + margin);
  return { arc, radius: Math.hypot(u, w) };
}

/**
 * The upper lip parts the nostrils from the mouth: a tube with a
 * `philtrum` (the nose) does not reach below its middle in front of the
 * lips, where its widened end would cover the mouth on coarse grids.
 */
function belowPhiltrum(point, philtrum) {
  return Boolean(philtrum) && point[2] > philtrum.z && point[1] < philtrum.y;
}

function classifyPoint(point, tubes, dx) {
  let found = null;
  for (const tube of tubes) {
    const place = locateInTube(point, tube, dx / 2);
    const { arc, radius } = place;
    const start = tube.start ?? 0;
    // A tube with a `front` (the lips) ends at that face plane even
    // where its last section is tilted.
    const inside =
      radius <= 1 &&
      arc >= start - dx / 2 &&
      arc <= tube.length + dx / 2 &&
      !(point[2] > (tube.front ?? Infinity) + dx / 2) &&
      !belowPhiltrum(point, tube.philtrum);
    // The tract below the glottis only takes the cells no other tube
    // holds, so the pouches beside the larynx keep their shape.
    const spare = arc < -dx / 2;
    const better =
      !found || (spare === found.spare ? radius < found.radius : found.spare);
    if (inside && better) {
      found = {
        ...place,
        kind: tube.kind,
        tube: tube.index,
        arc: Math.min(tube.length, Math.max(start, arc)),
        spare,
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

/**
 * Grid bounds around the tubes and radiation centres. The `grow` tubes
 * (the tract below the glottis) add whole cells, so the lattice stays
 * where the other tubes put it.
 */
function boundingBox(tubes, centres, dx, shape, grow = []) {
  const bounds = () => ({
    low: [Infinity, Infinity, Infinity],
    high: [-Infinity, -Infinity, -Infinity],
  });
  const include = (box, point, reach) => {
    for (let axis = 0; axis < 3; axis++) {
      box.low[axis] = Math.min(box.low[axis], point[axis] - reach);
      box.high[axis] = Math.max(box.high[axis], point[axis] + reach);
    }
  };
  const includeTube = (box, tube) => {
    const reach = Math.max(...tube.axes) + dx;
    for (let index = 0; index < tube.count; index++) {
      include(box, tube.points.subarray(index * 3, index * 3 + 3), reach);
    }
  };
  const { low, high } = bounds();
  for (const tube of tubes) {
    includeTube({ low, high }, tube);
  }
  for (const centre of centres) {
    include({ low, high }, centre, shape.radius + dx);
  }
  if (shape.box) {
    include({ low, high }, shape.box.low, 0);
    include({ low, high }, shape.box.high, 0);
  }
  const extra = bounds();
  grow.forEach((tube) => includeTube(extra, tube));
  for (let axis = 0; axis < 3; axis++) {
    if (extra.low[axis] < low[axis]) {
      low[axis] -= Math.ceil((low[axis] - extra.low[axis]) / dx) * dx;
    }
    high[axis] = Math.max(high[axis], extra.high[axis]);
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

/**
 * Grid axis closest to the direction in which a tube ends (+z at the lips,
 * -y at the nostrils): the links of its last cells into the free air
 * along this axis form the opening.
 */
function outwardAxis(tube) {
  const last = (tube.count - 1) * 3;
  const tangent = tube.tangents.subarray(last, last + 3);
  let index = 0;
  for (let axis = 1; axis < 3; axis++) {
    if (Math.abs(tangent[axis]) > Math.abs(tangent[index])) {
      index = axis;
    }
  }
  return { index, sign: Math.sign(tangent[index]) };
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
    // Only the end face radiates: a link through the side wall of the
    // last cells would let the field outside drive the tube sideways.
    const { index, sign } = context.outward[tube.kind];
    const step = Math.round((other.point[index] - tube.point[index]) / dx);
    if (tube.arc < lengths[tube.kind] - reach || step !== sign) {
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

/**
 * The pouches ride along with the larynx (issue 40): for every place of
 * the glottis, `places` whole cells below its rest place up to as many
 * above, each pouch opens into the tract cells its rest opening reaches
 * when moved by the shift of the tract centreline at its entry (see
 * pouchShift). The pouch cells stay where they are, so its volume and
 * shape do not change; at any place other than the rest the opening
 * links join cells that are not neighbours on the grid, a neck of one
 * cell to the tract wall the pouch would lie beside. Adds the links and
 * returns, per pouch, the opening links of each place.
 */
function movePouchOpenings(grid, collected, links, tubes, context) {
  const { dx, places, tract } = context;
  const { index, cells } = collected;
  const nearestTract = (target) => {
    const centre = target.map((value, axis) =>
      Math.floor((value - grid.low[axis]) / dx)
    );
    let best = -1;
    let bestDistance = Infinity;
    for (let i = centre[0] - 2; i <= centre[0] + 2; i++) {
      for (let j = centre[1] - 2; j <= centre[1] + 2; j++) {
        for (let k = centre[2] - 2; k <= centre[2] + 2; k++) {
          const cell = neighbourAt(grid, index, i, j, k);
          if (cell < 0 || cells[cell].kind !== CELL_TRACT) {
            continue;
          }
          const distance = Math.hypot(
            ...target.map((value, axis) => value - cells[cell].point[axis])
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            best = cell;
          }
        }
      }
    }
    return best;
  };
  const known = new Map();
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  links.a.forEach((a, link) => {
    known.set(key(a, links.b[link]), link);
  });
  const linkTo = (sinus, target) => {
    if (!known.has(key(sinus, target))) {
      known.set(key(sinus, target), links.a.length);
      links.a.push(sinus);
      links.b.push(target);
      links.kind.push(LINK_SINUS);
    }
    return known.get(key(sinus, target));
  };
  return tubes.map((tube) => {
    const rest = [];
    links.kind.forEach((kind, link) => {
      const [a, b] = [links.a[link], links.b[link]];
      if (kind === LINK_SINUS && cells[a].tube === tube.index) {
        rest.push([a, b]);
      } else if (kind === LINK_SINUS && cells[b].tube === tube.index) {
        rest.push([b, a]);
      }
    });
    return Array.from({ length: 2 * places + 1 }, (_, place) => {
      const rise = (place - places) * dx;
      const shift = pouchShift(tract, tube.entry, rise);
      const opening = new Set();
      for (const [sinus, wall] of rest) {
        const target = nearestTract(
          cells[wall].point.map((value, axis) => value + shift[axis])
        );
        if (target >= 0) {
          opening.add(linkTo(sinus, target));
        }
      }
      return Int32Array.from(opening);
    });
  });
}

/**
 * Put the links that touch a tract cell the glottis may close (arc below
 * `below`, see Fdtd3d#placeGlottis) first, by the lowest arc of those
 * cells: the links a place of the glottis closes are then a run from the
 * first link, which the step loop skips (Fdtd3d#activeFrom). The other
 * links keep their order; the pouch openings are renumbered.
 */
function orderLarynxLinks(links, openings, cells, below) {
  const lowest = links.a.map((a, link) => {
    let arc = Infinity;
    for (const cell of [a, links.b[link]]) {
      if (cells[cell].kind === CELL_TRACT && cells[cell].arc < below) {
        arc = Math.min(arc, cells[cell].arc);
      }
    }
    return arc;
  });
  const order = links.a.map((_, link) => link);
  // Array.prototype.sort is stable: equal arcs keep the grid order.
  order.sort((first, second) => {
    const a = lowest[first];
    const b = lowest[second];
    return a === b ? 0 : a === Infinity ? 1 : b === Infinity ? -1 : a - b;
  });
  const renumber = new Int32Array(order.length);
  order.forEach((link, position) => {
    renumber[link] = position;
  });
  return {
    links: {
      a: order.map((link) => links.a[link]),
      b: order.map((link) => links.b[link]),
      kind: order.map((link) => links.kind[link]),
    },
    openings: openings.map((places) =>
      places.map((place) => place.map((link) => renumber[link]))
    ),
  };
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
 * Tract cells in the incisor slices: the grid slices across z through the
 * incisor row, as the incisors are upright plates whatever the slope of
 * the airway between them. They become solid tooth or stay air depending
 * on the incisor gap (see Fdtd3d#applyTeeth). The upper incisal edge is
 * fixed to the skull where the 3D model draws it (incisorFrame); the
 * lower edge drops with the jaw.
 */
function teethCells(cells, config, layout, dx) {
  const { centre, edge, plane } = incisorFrame(config, layout);
  const reach = Math.max(dx, config.incisorThickness ?? INCISOR_THICKNESS) / 2;
  const members = [];
  const groups = [];
  cells.forEach((cell, index) => {
    if (
      cell.kind === CELL_TRACT &&
      cell.arc > centre - TEETH_APPROACH &&
      Math.abs(cell.point[2] - plane) <= reach
    ) {
      members.push(index);
      groups.push(Math.round(cell.point[2] / dx));
    }
  });
  return {
    cells: Int32Array.from(members),
    groups: Int32Array.from(groups),
    centre,
    plane,
    reach,
    edge,
    restGap: config.restGap ?? REST_GAP,
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
    () => noseAxes(noseMax),
    CELL_NOSE
  );
  const { lips, nostrils } = headLandmarks(config);
  tract.front = lips[2];
  nasal.philtrum = { y: (lips[1] + nostrils[1]) / 2, z: lips[2] - dx / 2 };
  const sinuses = sinusTubes(tract, config, dx, options);
  const travel = LARYNX_TRAVEL * length;
  const tubes = [
    extendTube(tract, travel),
    nasal,
    ...sinuses.map((tube) => ({ ...tube, kind: CELL_SINUS })),
  ];
  tubes.forEach((tube, index) => {
    tube.index = index;
  });
  const field = headField(config);
  // The lattice is that of the rest tract; the tube below grows it.
  const grid = boundingBox(
    [tract, ...tubes.slice(1)],
    [lips, nostrils],
    dx,
    shape,
    [tubes[0]]
  );
  const collected = collectCells(grid, tubes, field, [lips, nostrils], shape);
  const context = {
    dx,
    velumDistance,
    lengths: [tract.length, nasal.length],
    outward: [outwardAxis(tract), outwardAxis(nasal)],
    entries: tubes.map((tube) => tube.entry ?? 0),
    // Places of the glottis: whole cells up and down from the rest glottis.
    places: Math.floor(travel / dx + 1e-9),
  };
  const unordered = connect(grid, collected, context);
  const moved = movePouchOpenings(grid, collected, unordered, tubes.slice(2), {
    ...context,
    tract,
  });
  const { links, openings } = orderLarynxLinks(
    unordered,
    moved,
    collected.cells,
    (context.places - 0.5) * dx
  );
  const teeth = teethCells(collected.cells, config, tract.layout, dx);
  const open = openFaces(grid, collected, field, dx);
  return {
    dx,
    head: config,
    opening: openingTable(collected.cells, tubes[0], dx, teeth),
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
    // How far (cm) the glottis may move down into the tube below it, and
    // up from its rest place (see Fdtd3d#setGlottis).
    larynxTravel: travel,
    // Pouch tubes: tube index (as in cell.tube), name, opening arc on the
    // tract, depth (cm), cross-section (cm²) and, for each place of the
    // glottis from the lowest, the links that open it into the tract (see
    // movePouchOpenings).
    sinuses: sinuses.map((tube, index) => ({
      tube: index + 2,
      name: tube.name,
      entry: tube.entry,
      length: tube.length,
      area: tube.area,
      openings: openings[index],
    })),
    velumDistance,
    landmarks: { lips, nostrils },
    teeth,
  };
}
