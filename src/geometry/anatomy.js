/**
 * Meshes of the articulators inside the mouth: upper and lower teeth, the
 * tongue, the hard palate with the alveolar ridge and the soft palate
 * (velum) with the uvula. They are built from the same tract shape as the
 * acoustics, so the incisor gap is the one the solvers use, the tongue
 * dorsum is the lower wall of the tract tube and the velum opens with the
 * velopharyngeal port.
 *
 * Sizes follow dental and anatomical references: crown widths and
 * thicknesses of the permanent teeth measured on the Open-Full-Jaw scans,
 * crown heights from Wheeler's Dental Anatomy, a
 * beta-function dental arch fitted to the same scans, a palatal vault
 * 1-1.5 cm above the occlusal plane and a soft palate about 3.5 cm long.
 * The palate and velum follow the upper wall of the rest tract, whose bend
 * comes from the MRI tracts of the Dresden Vocal Tract Dataset.
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
 * height, labio-lingual thickness (cm), how thin the edge is (0 = knife
 * edge, 1 = flat occlusal surface) and how far the long axis leans out of
 * the mouth towards the edge (degrees from vertical). The incisors lean
 * about 20 degrees: the upper ones stand at about 110 degrees to the
 * palatal plane on cephalograms and the lower ones at about 90 degrees to
 * a mandibular plane tilted 25 degrees; the Human Reference Atlas mouths
 * lean 23 (upper) and 30-34 (lower) degrees.
 */
const UPPER_TEETH = [
  [0.89, 1.05, 0.74, 0.25, 21],
  [0.69, 0.9, 0.67, 0.3, 19],
  [0.76, 1.0, 0.82, 0.45, 10],
  [0.68, 0.8, 0.95, 0.85, 3],
  [0.68, 0.75, 0.95, 0.85, 0],
  [1.05, 0.7, 1.14, 0.95, 0],
  [0.95, 0.65, 1.14, 0.95, 0],
];
const LOWER_TEETH = [
  [0.54, 0.9, 0.58, 0.25, 22],
  [0.59, 0.95, 0.61, 0.3, 22],
  [0.68, 1.05, 0.74, 0.45, 20],
  [0.69, 0.8, 0.8, 0.85, 12],
  [0.7, 0.75, 0.86, 0.85, 6],
  [1.08, 0.7, 1.06, 0.95, 0],
  [1.07, 0.65, 1.05, 0.95, 0],
];
/**
 * Beta-function arch forms (Braun et al. 1998, Am J Orthod Dentofacial
 * Orthop 114, 1: 'Form of the human dental arch') through the middle of
 * the crowns: half width (cm, x mouthWidth) at the back of the second
 * molars and the power that sets how square the front is. Fitted to the
 * intercanine and intermolar widths and arch depths of the 17 Open-Full-Jaw
 * CBCT scans (tests/fixtures/anatomy/dentition.json), with the crown sizes
 * above set to their means there.
 */
const ARCH_FORMS = {
  upper: { halfWidth: 2.3, power: 0.3 },
  lower: { halfWidth: 2.375, power: 0.46 },
};
/** Lower incisors sit this far behind the upper ones (overjet, cm). */
const OVERJET = 0.25;
/**
 * Rise of the occlusal plane towards the back (cm per cm): it is tilted
 * about 10 degrees up from the incisors to the molars.
 */
const OCCLUSAL_TILT = 0.17;
/**
 * Posterior nasal spine behind the middle of the upper second molars (cm):
 * 0.9 cm on the Z-Anatomy skull, which puts the orale-staphylion length
 * of the presets near Tomaszewska et al. (2014).
 */
const PNS_BEHIND_MOLARS = 1;
/** Soft palate from the nasal spine to the velopharyngeal port, at least (cm). */
const VELAR_KNEE = 1;
/**
 * Velar length (hard palate to the tip of the uvula, along its middle) and
 * greatest thickness of adults on MRI (Perry et al. 2016: 35.7 and
 * 10.7 mm), scaled by the tract length from this reference (cm).
 */
const VELUM_LENGTH = 3.57;
const VELUM_THICKNESS = 1.07;
const REFERENCE_TRACT = 17.5;
/** How far the sides of the palatal vault reach below the airway (cm). */
const VAULT_DROP = 0.25;
/** Palate edge inside the middle of the upper crowns (cm). */
const PALATE_INSET = 0.45;
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
 * Dental arch of a jaw through the middle of its crowns, as closed at
 * rest: the beta curve of ARCH_FORMS, as deep as the crowns laid along it
 * need. Returns the point and inward normal at a signed arc length
 * (negative = left side).
 */
function jawArch(config, jaw) {
  const { front } = mouthFrame(config);
  const lower = jaw === 'lower';
  const teeth = lower ? LOWER_TEETH : UPPER_TEETH;
  const { halfWidth, power } = ARCH_FORMS[jaw];
  // The labial faces of the incisors: the upper ones at the incisor frame,
  // the lower ones OVERJET behind them.
  const labial = front - (lower ? OVERJET : 0);
  const width = halfWidth * config.mouthWidth;
  return cached(`arch ${jaw} ${width} ${labial}`, () => ({
    teeth,
    ...solveArch(teeth, width, power, labial - teeth[0][2] / 2),
  }));
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

function solveArch(teeth, halfWidth, power, front) {
  const total = teeth.reduce((sum, tooth) => sum + tooth[0], 0);
  const steps = 128;
  const curve = (depth) => {
    const points = [];
    let length = 0;
    for (let step = 0; step <= steps; step++) {
      const x = (step / steps) * halfWidth;
      const u = x / (2 * halfWidth);
      const z = front - depth * (1 - (4 * (0.25 - u * u)) ** power);
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
  for (let iteration = 0; iteration < 40; iteration++) {
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
    /** Half width of the arch at `z` (cm, head frame); 0 in front of it. */
    halfWidthAt(z) {
      const index = points.findIndex((point) => point[1] <= z);
      if (index <= 0) {
        return index ? halfWidth : 0;
      }
      const [x0, z0] = points[index - 1];
      const [x1, z1] = points[index];
      return lerp(x0, x1, (z0 - z) / Math.max(1e-9, z0 - z1));
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
        // Normal to the arch, towards the tongue: backwards at the
        // incisors, towards the midline at the molars.
        inward: [(side * (z1 - z0)) / norm, -(x1 - x0) / norm],
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
  const arch = jawArch(config, lower ? 'lower' : 'upper');
  const { teeth } = arch;
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
    const [, height, thickness, flat, lean] = crown;
    const [across, up] = profilePoint(step, lod.profile);
    // From the labial face, half a crown outside the arch, inwards; the
    // edge stays on the arch and the neck leans in towards the tongue.
    const depth =
      (across * lerp(flat, 1, up) - 0.5) * thickness +
      up * height * Math.tan((lean * Math.PI) / 180);
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

/**
 * Landmarks of the procedural teeth in the form toothLandmarks() gives for
 * segmented ones (millimetres, head frame, jaw closed to REST_GAP): the
 * occlusal point in the middle of each crown's edge, its width along the
 * arch and its labio-lingual thickness, so archMeasures() treats the model
 * and the anatomy alike.
 * @param {Record<string, number>} head
 */
export function dentalLandmarks(head) {
  const config = normalizeHeadConfig(head);
  const { edge, front } = mouthFrame(config);
  return ['upper', 'lower'].flatMap((jaw) => {
    const arch = jawArch(config, jaw);
    const base = jaw === 'lower' ? edge - REST_GAP : edge;
    let start = 0;
    return arch.teeth.flatMap(([width, , thickness], type) => {
      const middle = start + width / 2;
      start += width;
      return [-1, 1].map((sign) => {
        const { x, z } = arch.at(sign * middle);
        const point = [x, base + OCCLUSAL_TILT * (front - z), z];
        return {
          jaw,
          side: sign < 0 ? 'l' : 'r',
          type,
          occlusal: point.map((value) => value * 10),
          width: width * 10,
          thickness: thickness * 10,
        };
      });
    });
  });
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

/** Distance along the rest tract of the velopharyngeal port (cm). */
function portDistance(frame) {
  const { velumIndex, areas, length } = frame.shape;
  return ((velumIndex + 0.5) / areas.length) * length;
}

/**
 * Distance along the rest tract of the posterior nasal spine (cm):
 * PNS_BEHIND_MOLARS behind the upper second molars, but not closer to
 * the velopharyngeal port than VELAR_KNEE.
 */
function palateBack(frame, config) {
  const arch = jawArch(config, 'upper');
  const molar = arch.at(arch.total - arch.teeth.at(-1)[0] / 2).z;
  const target = molar - PNS_BEHIND_MOLARS;
  let low = Math.min(frame.start, portDistance(frame) + VELAR_KNEE);
  let high = frame.start;
  // The upper wall runs forward (+z) from the port to the incisors.
  for (let iteration = 0; iteration < 30; iteration++) {
    const middle = (low + high) / 2;
    if (restSection(frame, middle).point[2] < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Closed slab lining the upper wall of the rest tract between two
 * distances: its oral face is a vault over the airway, `width(s)` cm to
 * each side, and it is `thickness(s)` cm thick (s = 0..1 along it).
 * `place` may move each point (the lowered velum).
 */
function wallSlab(frame, from, to, sections, across, shape) {
  const columns = 2 * across + 1;
  const free = shape.free ?? (() => 0);
  const sagging = shape.sag ?? free;
  const rows = Array.from({ length: sections }, (_, row) => {
    const s = row / (sections - 1);
    return { s, ...restSection(frame, lerp(from, to, s)) };
  });
  return loftMesh(sections, 2 * columns, (row, step) => {
    const { s, point, normal, major, minor, shift } = rows[row];
    const oral = step < columns;
    const column = oral ? step : 2 * columns - 1 - step;
    const u = (2 * column) / (columns - 1) - 1;
    // A part hanging free of the wall (the uvula) is only as wide as
    // itself and sags off the wall by its thickness.
    const width = Math.max(
      (major + 0.2) * (1 - free(s)),
      shape.width(s, point)
    );
    const sag = sagging(s) * shape.thickness(s);
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
  const arch = jawArch(config, 'upper');
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
 * Soft palate and uvula hanging from the back of the hard palate: along
 * the upper wall of the tract to the velopharyngeal port, where it is
 * thickest (the velar knee), then free of the wall down to the tip of
 * the uvula, as long and thick as on MRI for the size of the head.
 * Raised (velum 0) it closes the port; lowered (velum 1) it swings
 * about the posterior nasal spine towards the tongue and opens it.
 * @param {Record<string, number>} head
 * @param {{lod?: number, velum?: number}} [options]
 */
export function velumMesh(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = ANATOMY_LODS[anatomyLod(options.lod)];
  const frame = mouthFrame(config);
  const { back, end, shape } = cached(`velum ${JSON.stringify(config)}`, () =>
    velumSpan(frame, config)
  );
  const pivot = restSection(frame, back).point;
  const tip = restSection(frame, portDistance(frame));
  // Swing the knee away from the upper wall, towards the tongue.
  const arm = [tip.point[1] - pivot[1], tip.point[2] - pivot[2]];
  const sign = -Math.sign(-arm[1] * tip.normal[1] + arm[0] * tip.normal[2]);
  const angle = sign * VELUM_DROP * clamp(options.velum ?? 0);
  return wallSlab(frame, back, end, lod.velum, lod.across, {
    ...shape,
    place: (vertex) => rotateJaw(vertex, pivot, angle),
  });
}

/** Width, thickness and free part of a soft palate ending at `end`. */
function velumShape(frame, config, back, end) {
  const size = config.vocalTractLength / REFERENCE_TRACT;
  const knee = (back - portDistance(frame)) / (back - end);
  const free = (s) => smoothstep(knee, (1 + knee) / 2, s);
  return {
    // It leaves the wall gradually, from before the knee to the uvula.
    sag: (s) => smoothstep(knee / 2, 1, s),
    width: (s) => lerp(1.5, 0.45, free(s)) * config.mouthWidth,
    thickness: (s) =>
      VELUM_THICKNESS *
      size *
      (0.6 +
        0.4 * Math.sin((Math.PI / 2) * Math.min(1, s / knee)) ** 2 -
        0.4 * free(s)),
    free,
  };
}

/**
 * Where along the rest tract the soft palate ends so that its middle,
 * which runs outside the bend of the tract and sags off the wall, is
 * VELUM_LENGTH long for the size of the head.
 */
function velumSpan(frame, config) {
  const back = palateBack(frame, config);
  const target = (VELUM_LENGTH * config.vocalTractLength) / REFERENCE_TRACT;
  const middleLength = (end) => {
    const shape = velumShape(frame, config, back, end);
    let length = 0;
    let last = null;
    for (let row = 0; row <= 16; row++) {
      const s = row / 16;
      const { point, normal, minor, shift } = restSection(
        frame,
        lerp(back, end, s)
      );
      const height = shift + minor + shape.thickness(s) * (0.5 - shape.sag(s));
      const middle = [1, 2].map((axis) => point[axis] + normal[axis] * height);
      length += last ? Math.hypot(middle[0] - last[0], middle[1] - last[1]) : 0;
      last = middle;
    }
    return length;
  };
  let low = Math.max(0, back - target);
  let high = Math.max(low, portDistance(frame) - 0.1);
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (middleLength(middle) > target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return { back, end: low, shape: velumShape(frame, config, back, low) };
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
