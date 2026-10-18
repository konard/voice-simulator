/**
 * Meshes of the articulators inside the mouth: upper and lower teeth, the
 * tongue, the hard palate with the alveolar ridge and the soft palate
 * (velum) with the uvula. They are built from the same tract shape as the
 * acoustics, so the incisor gap is the one the solvers use, the tongue
 * dorsum is the lower wall of the tract tube and the velum opens with the
 * velopharyngeal port.
 *
 * Sizes follow dental and anatomical references: crown widths and heights
 * of the permanent teeth (Wheeler's Dental Anatomy), a parabolic dental
 * arch about 5 cm wide between the molars, a palatal vault 1-1.5 cm above
 * the occlusal plane and a soft palate about 3.5 cm long.
 */

import { REST_GAP, incisorDepth } from '../articulation/teeth.js';
import { tractShape } from '../articulation/tract-shape.js';
import { normalizeHeadConfig } from '../head-config.js';
import {
  arcPoint,
  headLandmarks,
  incisorFrame,
  tractCenterline,
  upperNormal,
} from './centerline.js';
import { loftMesh } from './loft.js';
import { tractAxes } from './mesh.js';

/**
 * Level-of-detail resolutions of the articulator meshes, matched to
 * MESH_LODS: samples per half dental arch, points around a tooth profile,
 * tongue sections, points across the tongue/palate and velum sections.
 */
export const ANATOMY_LODS = Object.freeze([
  Object.freeze({ arch: 6, profile: 4, tongue: 8, across: 3, velum: 4 }),
  Object.freeze({ arch: 10, profile: 4, tongue: 12, across: 4, velum: 6 }),
  Object.freeze({ arch: 24, profile: 8, tongue: 20, across: 6, velum: 10 }),
  Object.freeze({ arch: 48, profile: 12, tongue: 32, across: 9, velum: 16 }),
]);

/**
 * Permanent teeth from the midline back (central incisor to second
 * molar, the third molar is left out): crown width along the arch, crown
 * height, labio-lingual thickness (cm) and how thin the edge is (0 = knife
 * edge, 1 = flat occlusal surface).
 */
const UPPER_TEETH = [
  [0.85, 1.05, 0.7, 0.25],
  [0.65, 0.9, 0.6, 0.3],
  [0.75, 1.0, 0.8, 0.45],
  [0.7, 0.8, 0.9, 0.85],
  [0.65, 0.75, 0.9, 0.85],
  [1.0, 0.7, 1.1, 0.95],
  [0.9, 0.65, 1.1, 0.95],
];
const LOWER_TEETH = [
  [0.5, 0.9, 0.6, 0.25],
  [0.55, 0.95, 0.6, 0.3],
  [0.7, 1.05, 0.75, 0.45],
  [0.7, 0.8, 0.8, 0.85],
  [0.7, 0.75, 0.85, 0.85],
  [1.1, 0.7, 1.05, 0.95],
  [1.05, 0.65, 1.05, 0.95],
];
/** Half width (cm) of the upper dental arch at the second molars. */
const ARCH_HALF_WIDTH = 2.65;
/** Lower incisors sit this far behind the upper ones (overjet, cm). */
const OVERJET = 0.25;
/**
 * Rise of the occlusal plane towards the back (cm per cm): it is tilted
 * about 10 degrees up from the incisors to the molars.
 */
const OCCLUSAL_TILT = 0.17;
/**
 * Hard palate, incisors to posterior nasal spine, as a share of the oral
 * tract (bend to lips): about 4.5 of 8 cm in MRI midsagittal sections.
 */
const HARD_PALATE = 0.55;
/** How far the sides of the palatal vault reach below the airway (cm). */
const VAULT_DROP = 0.25;
/** Palate edge inside the labial face of the dental arch (cm). */
const PALATE_INSET = 0.9;
/** Swing of the soft palate about the nasal spine when lowered (radians). */
const VELUM_DROP = 0.45;
/** Tongue from just above the larynx (fraction of the tract). */
const TONGUE_ROOT = 0.22;
/** Tongue surface just under the tract wall, so the two do not overlap (cm). */
const TONGUE_CLEARANCE = 0.05;

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Rotate a point about the jaw pivot in the midsagittal (y, z) plane. */
function rotateJaw(point, pivot, angle) {
  const dy = point[1] - pivot[1];
  const dz = point[2] - pivot[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0],
    pivot[1] + dy * cos - dz * sin,
    pivot[2] + dy * sin + dz * cos,
  ];
}

/** Rest tract of a head: shape, centreline layout and wall-held axes. */
function restTract(config) {
  return cached(`rest ${JSON.stringify(config)}`, () => {
    const shape = tractShape({}, config);
    const { layout } = tractCenterline(config, {
      sections: 1,
      length: shape.length,
    });
    return { shape, layout, axes: tractAxes(config, shape.areas) };
  });
}

/**
 * Common landmarks of the mouth for a normalised head: the incisal edge
 * and labial face of the upper incisors sit where the acoustic models put
 * them on the rest tract (incisorFrame), so the teeth, palate and velum
 * line the same airway the solvers use.
 */
function mouthFrame(config) {
  const { lips, jawPivot } = headLandmarks(config);
  const rest = restTract(config);
  const { edge, front, start } = incisorFrame(config, rest.layout);
  return { lips, jawPivot, edge, front, start, ...rest };
}

/**
 * Point on the rest tract `distance` cm from the glottis, with its upper
 * normal, the rest semi-axes and the shift of the section centre.
 */
function restSection(frame, distance) {
  const { point, tangent } = arcPoint(distance, frame.layout);
  const position = distance / frame.layout.length;
  const area = sampleAreas(frame.shape.areas, position);
  const [major, minor, shift] = frame.axes(area, position);
  return { point, normal: upperNormal(tangent), major, minor, shift };
}

/**
 * Parabolic arch whose half length equals the summed crown widths. Returns
 * the labial point and inward normal at a signed arc length (negative =
 * left side).
 */
function archCurve(teeth, halfWidth, front) {
  return cached(`arch ${teeth === LOWER_TEETH} ${halfWidth} ${front}`, () =>
    solveArch(teeth, halfWidth, front)
  );
}

/** Parts that only depend on the head and LOD; the viewer rebuilds the
 * tongue, velum and lower teeth every frame. */
const cache = new Map();

function cached(key, build) {
  let value = cache.get(key);
  if (value === undefined) {
    if (cache.size >= 64) {
      cache.clear();
    }
    value = build();
    cache.set(key, value);
  }
  return value;
}

function solveArch(teeth, halfWidth, front) {
  const total = teeth.reduce((sum, tooth) => sum + tooth[0], 0);
  const steps = 64;
  const curve = (depth) => {
    const points = [];
    let length = 0;
    for (let step = 0; step <= steps; step++) {
      const x = (step / steps) * halfWidth;
      const z = front - depth * (x / halfWidth) ** 2;
      if (step) {
        const [px, pz] = points.at(-1);
        length += Math.hypot(x - px, z - pz);
      }
      points.push([x, z, length]);
    }
    return points;
  };
  let low = 0;
  let high = 3 * total;
  for (let iteration = 0; iteration < 32; iteration++) {
    const depth = (low + high) / 2;
    if (curve(depth).at(-1)[2] < total) {
      low = depth;
    } else {
      high = depth;
    }
  }
  const points = curve(low);
  const depth = low;
  return {
    total,
    /** Half width of the arch's labial face `z` (cm, head frame). */
    halfWidthAt(z) {
      return halfWidth * Math.sqrt(clamp((front - z) / Math.max(1e-6, depth)));
    },
    at(signed) {
      const along = Math.min(total, Math.abs(signed));
      let index = 1;
      while (index < steps && points[index][2] < along) {
        index++;
      }
      const [x0, z0, l0] = points[index - 1];
      const [x1, z1, l1] = points[index];
      const t = (along - l0) / Math.max(1e-9, l1 - l0);
      const side = signed < 0 ? -1 : 1;
      const norm = Math.hypot(x1 - x0, z1 - z0);
      return {
        x: side * lerp(x0, x1, t),
        z: lerp(z0, z1, t),
        inward: [(-side * (x1 - x0)) / norm, (z1 - z0) / norm],
      };
    },
  };
}

/** Crown size at an arc length, blended between neighbouring teeth. */
function crownAt(teeth, along, notches) {
  let start = 0;
  for (let index = 0; index < teeth.length; index++) {
    const width = teeth[index][0];
    if (along <= start + width || index === teeth.length - 1) {
      const phase = clamp((along - start) / width);
      const next = teeth[Math.min(teeth.length - 1, index + 1)];
      const previous = teeth[Math.max(0, index - 1)];
      const blend = phase < 0.5 ? previous : next;
      const weight = 0.5 * smoothstep(0.5, 0, Math.min(phase, 1 - phase));
      const crown = teeth[index].map((value, key) =>
        lerp(value, blend[key], weight)
      );
      if (notches) {
        const boundary = Math.min(phase, 1 - phase) * width;
        crown[1] *= 1 - 0.3 * Math.exp(-((boundary / 0.08) ** 2));
      }
      return crown;
    }
    start += width;
  }
  return teeth.at(-1);
}

/** Corner-biased points around a square, so 4 points make a box. */
function profilePoint(step, count) {
  const angle = (2 * Math.PI * (step + 0.5)) / count;
  const u = Math.cos(angle);
  const v = Math.sin(angle);
  const scale = Math.max(Math.abs(u), Math.abs(v));
  return [(u / scale + 1) / 2, (v / scale + 1) / 2];
}

function anatomyLod(lod) {
  return clamp(Math.round(lod ?? 1), 0, ANATOMY_LODS.length - 1);
}

/**
 * Jaw rotation (radians, positive opens) about the jaw pivot that puts the
 * lower incisal edge `gap` cm below the upper one.
 * @param {number} gap Inter-incisor gap (cm), e.g. tractShape().teeth.gap.
 * @param {Record<string, number>} head
 */
export function jawAngle(gap, head) {
  const config = normalizeHeadConfig(head);
  const { jawPivot, edge, front } = mouthFrame(config);
  const dy = edge - REST_GAP - jawPivot[1];
  const dz = front - OVERJET - jawPivot[2];
  const radius = Math.hypot(dy, dz);
  const target = clamp((edge - gap - jawPivot[1]) / radius, -1, 1);
  return Math.acos(target) - Math.atan2(dz, dy);
}

/**
 * Jaw openness 0..1 for deformJaw() that matches jawAngle().
 * @param {number} gap
 * @param {Record<string, number>} head
 */
export function jawOpenness(gap, head) {
  const config = normalizeHeadConfig(head);
  return clamp(jawAngle(gap, config) / (0.22 * config.jawRange));
}

/**
 * Midline incisal edges (cm, head frame) of the upper and lower central
 * incisors for an inter-incisor gap.
 * @param {number} gap
 * @param {Record<string, number>} head
 */
export function incisorEdges(gap, head) {
  const config = normalizeHeadConfig(head);
  const { jawPivot, edge, front } = mouthFrame(config);
  return {
    upper: [0, edge, front],
    lower: rotateJaw(
      [0, edge - REST_GAP, front - OVERJET],
      jawPivot,
      jawAngle(gap, config)
    ),
  };
}

/** Copy of a dental arch at rest (jaw closed to REST_GAP). */
function restArch(config, lod, lower) {
  const level = anatomyLod(lod);
  const key = `teeth ${lower} ${level} ${JSON.stringify(config)}`;
  const mesh = cached(key, () => archMesh(config, level, lower));
  return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
}

function archMesh(config, level, lower) {
  const lod = ANATOMY_LODS[level];
  const { edge, front } = mouthFrame(config);
  const teeth = lower ? LOWER_TEETH : UPPER_TEETH;
  const halfWidth =
    (ARCH_HALF_WIDTH - (lower ? OVERJET : 0)) * config.mouthWidth;
  const arch = archCurve(teeth, halfWidth, lower ? front - OVERJET : front);
  const base = lower ? edge - REST_GAP : edge;
  const direction = lower ? -1 : 1;
  const sections = 2 * lod.arch + 1;
  const notches = lod.arch >= ANATOMY_LODS[2].arch;
  const samples = Array.from({ length: sections }, (_, section) => {
    const signed = arch.total * ((2 * section) / (sections - 1) - 1);
    return {
      ...arch.at(signed),
      crown: crownAt(teeth, Math.abs(signed), notches),
    };
  });
  return loftMesh(sections, lod.profile, (section, step) => {
    const { x, z, inward, crown } = samples[section];
    const [, height, thickness, flat] = crown;
    const [across, up] = profilePoint(step, lod.profile);
    const depth = across * thickness * lerp(flat, 1, up);
    return [
      x + inward[0] * depth,
      base + OCCLUSAL_TILT * (front - z) + direction * up * height,
      z + inward[1] * depth,
    ];
  });
}

/**
 * Upper dental arch (incisors to second molars).
 * @param {Record<string, number>} head
 * @param {{lod?: number}} [options]
 */
export function upperTeethMesh(head, options = {}) {
  return restArch(normalizeHeadConfig(head), options.lod, false);
}

/**
 * Lower dental arch, carried by the jaw so the incisal edges are `gap` cm
 * apart.
 * @param {Record<string, number>} head
 * @param {{lod?: number, gap?: number}} [options]
 */
export function lowerTeethMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const mesh = restArch(config, options.lod, true);
  const angle = jawAngle(options.gap ?? REST_GAP, config);
  const { jawPivot } = mouthFrame(config);
  const { positions } = mesh;
  for (let index = 0; index < positions.length; index += 3) {
    const point = [
      positions[index],
      positions[index + 1],
      positions[index + 2],
    ];
    positions.set(rotateJaw(point, jawPivot, angle), index);
  }
  return mesh;
}

function sampleAreas(areas, fraction) {
  const source = clamp(fraction) * (areas.length - 1);
  const lower = Math.floor(source);
  const upper = Math.min(areas.length - 1, lower + 1);
  return lerp(areas[lower], areas[upper], source - lower);
}

/**
 * Tongue body from just above the larynx to the tip behind the lower
 * incisors. Its upper surface is the lower (front, in the pharynx) wall
 * of the tract tube, which moves with the area function while the palate
 * and the back of the pharynx stay put (tractAxes).
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object, shape?: object}} [options]
 *   `shape` is a precomputed tractShape(state, head).
 */
export function tongueMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const shape = options.shape ?? tractShape(options.state ?? {}, config);
  const { areas, length } = shape;
  const { layout } = tractCenterline(config, { sections: 1, length });
  const { axes } = restTract(config);
  const teethStart = shape.teeth?.start ?? length - incisorDepth(config) - 0.7;
  const tip = clamp((teethStart - 0.15) / length, TONGUE_ROOT + 0.1, 0.98);
  const size = Math.cbrt(config.tongueSize);
  const ring = 2 * (lod.across + 1);
  const rings = Array.from({ length: lod.tongue }, (_, section) => {
    const s = section / (lod.tongue - 1);
    const fraction = lerp(TONGUE_ROOT, tip, s);
    const { point, tangent } = arcPoint(fraction * length, layout);
    const [, minor, shift] = axes(sampleAreas(areas, fraction), fraction);
    const taper =
      s > 0.8 ? Math.sqrt(Math.max(0.05, 1 - ((s - 0.8) / 0.2) ** 2)) : 1;
    const width = (1.2 + 0.35 * smoothstep(0, 0.35, s)) * taper * size;
    const depth = (0.25 + 2.3 * Math.sin(Math.PI * (0.15 + 0.85 * s))) * size;
    const wall = minor - shift + TONGUE_CLEARANCE;
    return { point, normal: upperNormal(tangent), wall, width, depth };
  });
  return loftMesh(lod.tongue, ring, (section, step) => {
    const { point, normal, wall, width, depth } = rings[section];
    const top = step <= lod.across;
    const index = top ? step : ring - 1 - step;
    const across = (2 * index) / lod.across - 1;
    const dome = 0.35 * across * across;
    const below = top ? 0 : 0.2 + depth * Math.sqrt(1 - across * across);
    const drop = wall + dome + below;
    return [
      across * width,
      point[1] - normal[1] * drop,
      point[2] - normal[2] * drop,
    ];
  });
}

/** Distance along the rest tract of the posterior nasal spine (cm). */
function palateBack(frame, config) {
  const oral = (1 - config.pharynxRatio) * frame.layout.length;
  return frame.start - HARD_PALATE * oral;
}

/**
 * Closed slab lining the upper wall of the rest tract between two
 * distances: its oral face is a vault over the airway, `width(s)` cm to
 * each side, and it is `thickness(s)` cm thick (s = 0..1 along it).
 * `place` may move each point (the lowered velum).
 */
function wallSlab(frame, from, to, sections, across, shape) {
  const columns = 2 * across + 1;
  const rows = Array.from({ length: sections }, (_, row) => {
    const s = row / (sections - 1);
    return { s, ...restSection(frame, lerp(from, to, s)) };
  });
  return loftMesh(sections, 2 * columns, (row, step) => {
    const { s, point, normal, major, minor, shift } = rows[row];
    const oral = step < columns;
    const column = oral ? step : 2 * columns - 1 - step;
    const u = (2 * column) / (columns - 1) - 1;
    const width = Math.max(major + 0.2, shape.width(s, point));
    const sag = shape.sag?.(s) ?? 0;
    // The vault, or the airway's own wall where that is higher.
    const wall =
      minor * Math.sqrt(Math.max(0, 1 - (u * width) ** 2 / major ** 2));
    const vault = Math.max(
      wall,
      (minor + VAULT_DROP) * Math.sqrt(1 - u * u) - VAULT_DROP
    );
    const height = shift + vault - sag + (oral ? 0 : shape.thickness(s));
    const vertex = [
      u * width,
      point[1] + normal[1] * height,
      point[2] + normal[2] * height,
    ];
    return shape.place ? shape.place(vertex) : vertex;
  });
}

/**
 * Hard palate with the alveolar ridge: a vaulted bony slab on the upper
 * wall of the rest tract from the upper incisors back to the posterior
 * nasal spine, as wide as the space between the upper teeth.
 * @param {Record<string, number>} head
 * @param {{lod?: number}} [options]
 */
export function palateMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const frame = mouthFrame(config);
  const arch = archCurve(
    UPPER_TEETH,
    ARCH_HALF_WIDTH * config.mouthWidth,
    frame.front
  );
  return wallSlab(
    frame,
    frame.start,
    palateBack(frame, config),
    lod.tongue,
    lod.across,
    {
      width: (_, point) => arch.halfWidthAt(point[2]) - PALATE_INSET,
      thickness: (s) => lerp(0.9, 0.5, smoothstep(0, 0.3, s)),
    }
  );
}

/**
 * Soft palate and uvula hanging from the back of the hard palate along
 * the upper wall of the tract to the velopharyngeal port. Raised (velum
 * 0) it closes the port; lowered (velum 1) it swings down about the
 * posterior nasal spine towards the tongue and opens it.
 * @param {Record<string, number>} head
 * @param {{lod?: number, velum?: number}} [options]
 */
export function velumMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const frame = mouthFrame(config);
  const back = palateBack(frame, config);
  const port =
    ((frame.shape.velumIndex + 0.5) / frame.shape.areas.length) *
    frame.shape.length;
  const pivot = restSection(frame, back).point;
  const tip = restSection(frame, port);
  // Swing the tip away from the upper wall, towards the tongue.
  const arm = [tip.point[1] - pivot[1], tip.point[2] - pivot[2]];
  const sign = -Math.sign(-arm[1] * tip.normal[1] + arm[0] * tip.normal[2]);
  const angle = sign * VELUM_DROP * clamp(options.velum ?? 0);
  const scale = config.mouthWidth;
  return wallSlab(frame, back, port, lod.velum, lod.across, {
    width: (s) => lerp(1.5, 0.45, s ** 1.5) * scale,
    thickness: (s) => lerp(0.9, 0.55, s),
    sag: (s) => 0.35 * s ** 4,
    place: (vertex) => rotateJaw(vertex, pivot, angle),
  });
}

/**
 * All articulator meshes for a state, named like headModel() parts.
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object, shape?: object}} [options]
 *   `shape` is a precomputed tractShape(state, head).
 * @returns {{name: string, positions: Float32Array, indices: Uint32Array}[]}
 */
export function anatomyMeshes(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const state = options.state ?? {};
  const shape = options.shape ?? tractShape(state, config);
  const lod = anatomyLod(options.lod);
  const gap = shape.teeth?.gap ?? REST_GAP;
  return [
    { name: 'upperTeeth', ...upperTeethMesh(config, { lod }) },
    { name: 'lowerTeeth', ...lowerTeethMesh(config, { lod, gap }) },
    { name: 'tongue', ...tongueMesh(config, { lod, shape }) },
    { name: 'palate', ...palateMesh(config, { lod }) },
    { name: 'velum', ...velumMesh(config, { lod, velum: state.velum ?? 0 }) },
  ];
}
