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
import { arcPoint, headLandmarks, tractCenterline } from './centerline.js';
import { MESH_LODS, sectionAxes, tubeMesh } from './mesh.js';

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
/** Gum line above the upper incisal edges (cm). */
const GUM_HEIGHT = 0.9;
/** Tongue from just above the larynx (fraction of the tract). */
const TONGUE_ROOT = 0.22;

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

/** Common landmarks of the mouth for a normalised head. */
function mouthFrame(config) {
  const { lips, jawPivot } = headLandmarks(config);
  const edge = lips[1] + REST_GAP / 2;
  const front = lips[2] - incisorDepth(config);
  return { lips, jawPivot, edge, front };
}

/**
 * Parabolic arch whose half length equals the summed crown widths. Returns
 * the labial point and inward normal at a signed arc length (negative =
 * left side).
 */
function archCurve(teeth, halfWidth, front) {
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
  return {
    total,
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

function loftIndices(sections, ring) {
  const indices = [];
  for (let section = 0; section < sections - 1; section++) {
    for (let step = 0; step < ring; step++) {
      const a = section * ring + step;
      const b = section * ring + ((step + 1) % ring);
      indices.push(a, a + ring, b, b, a + ring, b + ring);
    }
  }
  const first = sections * ring;
  const last = first + 1;
  const end = (sections - 1) * ring;
  for (let step = 0; step < ring; step++) {
    const next = (step + 1) % ring;
    indices.push(first, next, step, last, end + step, end + next);
  }
  return Uint32Array.from(indices);
}

/**
 * Closed mesh swept through `sections` rings of `ring` points, with a
 * centre vertex capping each end.
 * @param {(section: number, step: number) => number[]} vertex
 */
function loftMesh(sections, ring, vertex) {
  const positions = new Float32Array((sections * ring + 2) * 3);
  for (let section = 0; section < sections; section++) {
    for (let step = 0; step < ring; step++) {
      positions.set(vertex(section, step), (section * ring + step) * 3);
    }
  }
  for (const [cap, section] of [
    [sections * ring, 0],
    [sections * ring + 1, sections - 1],
  ]) {
    for (let axis = 0; axis < 3; axis++) {
      let sum = 0;
      for (let step = 0; step < ring; step++) {
        sum += positions[(section * ring + step) * 3 + axis];
      }
      positions[cap * 3 + axis] = sum / ring;
    }
  }
  return { positions, indices: loftIndices(sections, ring) };
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

function archMesh(config, options, lower) {
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const { jawPivot, edge, front } = mouthFrame(config);
  const teeth = lower ? LOWER_TEETH : UPPER_TEETH;
  const halfWidth =
    (ARCH_HALF_WIDTH - (lower ? OVERJET : 0)) * config.mouthWidth;
  const arch = archCurve(teeth, halfWidth, lower ? front - OVERJET : front);
  const base = lower ? edge - REST_GAP : edge;
  const direction = lower ? -1 : 1;
  const angle = lower ? jawAngle(options.gap ?? REST_GAP, config) : 0;
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
    const point = [
      x + inward[0] * depth,
      base + direction * up * height,
      z + inward[1] * depth,
    ];
    return angle ? rotateJaw(point, jawPivot, angle) : point;
  });
}

/**
 * Upper dental arch (incisors to second molars).
 * @param {Record<string, number>} head
 * @param {{lod?: number}} [options]
 */
export function upperTeethMesh(head, options = {}) {
  return archMesh(normalizeHeadConfig(head), options, false);
}

/**
 * Lower dental arch, carried by the jaw so the incisal edges are `gap` cm
 * apart.
 * @param {Record<string, number>} head
 * @param {{lod?: number, gap?: number}} [options]
 */
export function lowerTeethMesh(head, options = {}) {
  return archMesh(normalizeHeadConfig(head), options, true);
}

function interpolate(areas, fraction) {
  const source = clamp(fraction) * (areas.length - 1);
  const lower = Math.floor(source);
  const upper = Math.min(areas.length - 1, lower + 1);
  return lerp(areas[lower], areas[upper], source - lower);
}

/**
 * Tongue body from just above the larynx to the tip behind the lower
 * incisors. Its upper surface is the lower (front, in the pharynx) wall
 * of the tract tube, so it rises and falls with the area function.
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
  const teethStart = shape.teeth?.start ?? length - incisorDepth(config) - 0.7;
  const tip = clamp((teethStart - 0.15) / length, TONGUE_ROOT + 0.1, 0.98);
  const size = Math.cbrt(config.tongueSize);
  const ring = 2 * (lod.across + 1);
  const rings = Array.from({ length: lod.tongue }, (_, section) => {
    const s = section / (lod.tongue - 1);
    const fraction = lerp(TONGUE_ROOT, tip, s);
    const { point, tangent } = arcPoint(fraction * length, layout);
    // Same frame as the tube mesh: side = +x, normal = tangent × side.
    const normal = [0, tangent[2], -tangent[1]];
    const [, minor] = sectionAxes(
      interpolate(areas, fraction),
      fraction,
      config
    );
    const taper =
      s > 0.8 ? Math.sqrt(Math.max(0.05, 1 - ((s - 0.8) / 0.2) ** 2)) : 1;
    const width = (1.2 + 0.35 * smoothstep(0, 0.35, s)) * taper * size;
    const depth = (0.25 + 2.3 * Math.sin(Math.PI * (0.15 + 0.85 * s))) * size;
    return { point, normal, minor, width, depth };
  });
  return loftMesh(lod.tongue, ring, (section, step) => {
    const { point, normal, minor, width, depth } = rings[section];
    const top = step <= lod.across;
    const index = top ? step : ring - 1 - step;
    const across = (2 * index) / lod.across - 1;
    const dome = 0.35 * across * across;
    const below = top ? 0 : 0.2 + depth * Math.sqrt(1 - across * across);
    const drop = minor + dome + below;
    return [
      across * width,
      point[1] - normal[1] * drop,
      point[2] - normal[2] * drop,
    ];
  });
}

/** Height of the palatal vault above the gum line, `d` cm behind the incisors. */
function vaultHeight(d) {
  return (
    0.15 +
    0.75 * smoothstep(0.3, 2.2, d) +
    0.18 * Math.exp(-(((d - 0.45) / 0.3) ** 2))
  );
}

/** Hard palate geometry shared by the palate and velum meshes. */
function hardPalate(config) {
  const { edge, front } = mouthFrame(config);
  const halfWidth = ARCH_HALF_WIDTH * config.mouthWidth;
  const arch = archCurve(UPPER_TEETH, halfWidth, front);
  const back = arch.at(arch.total).z;
  const start = front - UPPER_TEETH[0][2];
  const gum = edge + GUM_HEIGHT;
  const depthAt = (z) =>
    ((front - z) / Math.max(1e-6, front - back)) ** 0.5 * halfWidth;
  return { start, back, gum, depthAt, end: start - back };
}

/**
 * Hard palate with the alveolar ridge: a vaulted sheet between the upper
 * teeth from behind the incisors to the posterior nasal spine.
 * @param {Record<string, number>} head
 * @param {{lod?: number}} [options]
 */
export function palateMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const palate = hardPalate(config);
  const rows = lod.tongue;
  const columns = 2 * lod.across + 1;
  const positions = new Float32Array(rows * columns * 3);
  for (let row = 0; row < rows; row++) {
    const d = (palate.end * row) / (rows - 1);
    const z = palate.start - d;
    const halfWidth = Math.max(0.3, palate.depthAt(z) - 0.75);
    for (let column = 0; column < columns; column++) {
      const across = (2 * column) / (columns - 1) - 1;
      const rise = vaultHeight(d) * (1 - Math.abs(across) ** 2.5) ** 0.8;
      positions.set(
        [across * halfWidth, palate.gum + rise, z],
        (row * columns + column) * 3
      );
    }
  }
  const indices = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
    }
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/**
 * Soft palate and uvula hanging from the back of the hard palate. Raised
 * (velum 0) it closes against the back wall of the pharynx; lowered
 * (velum 1) it drops towards the tongue and opens the nasal port.
 * @param {Record<string, number>} head
 * @param {{lod?: number, velum?: number}} [options]
 */
export function velumMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const { lips } = headLandmarks(config);
  const palate = hardPalate(config);
  const { layout } = tractCenterline(config, { sections: 1 });
  const start = [0, palate.gum + vaultHeight(palate.end), palate.back];
  const raised = [0, lips[1] + 0.9, layout.origin[2] - 0.2];
  const lowered = [0, lips[1] + 0.2, palate.back - 1.5];
  const open = clamp(options.velum ?? 0);
  const end = raised.map((value, axis) => lerp(value, lowered[axis], open));
  const control = [0, start[1] - 0.2, lerp(start[2], end[2], 0.5) + 0.3];
  const count = lod.velum;
  const points = new Float64Array(count * 3);
  const tangents = new Float64Array(count * 3);
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    const u = 1 - t;
    const derivative = [];
    for (let axis = 0; axis < 3; axis++) {
      points[index * 3 + axis] =
        u * u * start[axis] + 2 * u * t * control[axis] + t * t * end[axis];
      derivative.push(
        2 * u * (control[axis] - start[axis]) +
          2 * t * (end[axis] - control[axis])
      );
    }
    const norm = Math.hypot(...derivative) || 1;
    tangents.set(
      derivative.map((value) => value / norm),
      index * 3
    );
  }
  const positionOf = Array.from({ length: count }, (_, index) => index);
  const mesh = tubeMesh({ points, tangents, count }, positionOf, {
    lod: Math.min(anatomyLod(options.lod), MESH_LODS.length - 1),
    axes: (_, position) => {
      const uvula = Math.exp(-(((position - 0.9) / 0.1) ** 2));
      return [
        lerp(1.3, 0.3, position ** 1.5) + 0.1 * uvula,
        lerp(0.45, 0.25, position) + 0.1 * uvula,
      ];
    },
  });
  return { positions: mesh.positions, indices: mesh.indices };
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
