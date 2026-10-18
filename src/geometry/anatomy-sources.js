/**
 * Anatomy sources switched part by part: every articulator of the head
 * model (upper and lower teeth, tongue, hard palate, velum) comes from the
 * procedural model or from any segmented 3D dataset: the HuBMAP HRA
 * Visible Human, Z-Anatomy, BodyParts3D, Open-Full-Jaw or a user's own
 * glTF or STL.
 *
 * A source is data: one mesh per part in millimetres (+y up, +z forward,
 * the body's left at -x) and its key points (reference-anatomy.js). Placed
 * into a head, it is fitted onto the head's own key points (rigidly, or
 * scaled to the head with `scale: true`), the lower teeth ride on the jaw
 * and every part is reduced from its full resolution to the head model's
 * level of detail by vertex clustering. Scans hold one posture, so a
 * scanned tongue or velum stays as recorded.
 *
 * The acoustic solvers work on the area function, which the head
 * parameters set; sourceHead() reduces a source to them (the arch width
 * sets mouthWidth, which also sets the incisor slot).
 */

import { getHeadParameter, normalizeHeadConfig } from '../head-config.js';
import { tractShape } from '../articulation/tract-shape.js';
import { rigidFit, transformMesh, transformPoint } from './align.js';
import {
  anatomyLod,
  anatomyMeshes,
  dentalLandmarks,
  jawPose,
} from './anatomy.js';
import { clusterVertices } from './decimate.js';
import { readGlbMeshes } from './gltf-read.js';
import { mergeMeshes } from './loft.js';
import {
  KEY_POINTS,
  HRA_PARTS,
  mirrorX,
  modelKeyPoints,
  referenceKeyPoints,
  referenceParts,
  referenceTeeth,
} from './reference-anatomy.js';

export const ANATOMY_PARTS = Object.freeze([
  'upperTeeth',
  'lowerTeeth',
  'tongue',
  'palate',
  'velum',
]);
export const PROCEDURAL = 'procedural';
/** Vertex clustering cube (mm) per anatomy LOD; 0 keeps every vertex. */
export const SOURCE_LOD_CELLS = Object.freeze([4, 2, 1, 0]);
/** Bony landmarks that hold still whatever the posture of a scan. */
export const DENTAL_KEY_POINTS = Object.freeze([
  'upperIncisor',
  'lowerIncisor',
  'upperFirstMolar',
  'upperSecondMolar',
  'palateVault',
]);
const FIRST_MOLAR = 5;
const MM = 0.1;

const registry = new Map();

/**
 * Build a source from named meshes.
 * @param {string} name
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 *   Millimetres, +y up, +z forward, the body's left at -x.
 * @param {{roles?: Record<string, (name: string) => boolean>,
 *   keyPoints?: Record<string, number[]>, citation?: string,
 *   license?: string}} [options] `roles` tests mesh names per part
 *   (HRA_PARTS by default; arytenoids and thyroid give the glottis).
 */
export function anatomySource(name, meshes, options = {}) {
  if (!name || name === PROCEDURAL) {
    throw new Error(
      `An anatomy source needs a name other than "${PROCEDURAL}"`
    );
  }
  const grouped = referenceParts(meshes, options.roles ?? HRA_PARTS);
  const parts = Object.fromEntries(
    ANATOMY_PARTS.filter((part) => grouped[part]?.length).map((part) => [
      part,
      mergeMeshes(grouped[part]),
    ])
  );
  if (!Object.keys(parts).length) {
    throw new Error(`No mesh of "${name}" matches a part`);
  }
  const keyPoints = options.keyPoints ?? referenceKeyPoints(grouped);
  const teeth = referenceTeeth(grouped);
  return Object.freeze({
    name,
    citation: options.citation ?? '',
    license: options.license ?? '',
    parts,
    keyPoints,
    archWidth: intermolarWidth(teeth),
  });
}

/**
 * Build a source from a glTF binary (e.g. an exported character or atlas).
 * @param {string} name
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{scale?: number, mirror?: boolean, roles?: object,
 *   citation?: string, license?: string}} [options] `scale` turns the
 *   file's units into millimetres (1000 for metres); `mirror` when the
 *   body's left is at +x.
 */
export function anatomySourceFromGlb(name, bytes, options = {}) {
  const meshes = readGlbMeshes(bytes, { scale: options.scale ?? 1000 });
  return anatomySource(
    name,
    options.mirror ? mirrorX(meshes) : meshes,
    options
  );
}

/** Make a source selectable by name. */
export function registerAnatomySource(source) {
  if (!source?.name || !source.parts) {
    throw new Error(
      'registerAnatomySource needs a source from anatomySource()'
    );
  }
  registry.set(source.name, source);
  return source;
}

/** Remove a registered source. */
export function unregisterAnatomySource(name) {
  return registry.delete(name);
}

/** Names of the selectable sources, the procedural model first. */
export function anatomySourceNames() {
  return [PROCEDURAL, ...registry.keys()];
}

/**
 * Parts each selectable source provides.
 * @returns {Record<string, string[]>}
 */
export function anatomySourceParts() {
  return Object.fromEntries(
    anatomySourceNames().map((name) => [
      name,
      name === PROCEDURAL
        ? [...ANATOMY_PARTS]
        : Object.keys(registry.get(name).parts),
    ])
  );
}

function resolveSource(source) {
  if (typeof source !== 'string') {
    return source;
  }
  const found = registry.get(source);
  if (!found) {
    throw new Error(
      `Unknown anatomy source "${source}" (known: ${anatomySourceNames().join(', ')})`
    );
  }
  return found;
}

/**
 * Per-part selection: a source name for every part, or an object that
 * names a source per part (missing parts stay procedural).
 * @param {string|Record<string, string|object>|undefined} selection
 * @returns {Record<string, string|object>}
 */
export function anatomySelection(selection) {
  if (selection === undefined || selection === null) {
    return {};
  }
  if (typeof selection === 'string' || selection.parts) {
    const source = resolveSource(selection);
    return Object.fromEntries(
      Object.keys(source.parts ?? {}).map((part) => [part, source])
    );
  }
  for (const part of Object.keys(selection)) {
    if (!ANATOMY_PARTS.includes(part)) {
      throw new Error(
        `Unknown anatomy part "${part}" (parts: ${ANATOMY_PARTS.join(', ')})`
      );
    }
  }
  return Object.fromEntries(
    Object.entries(selection)
      .filter(([, source]) => source && source !== PROCEDURAL)
      .map(([part, source]) => [part, resolveSource(source)])
  );
}

function intermolarWidth(landmarks) {
  const molars = landmarks.filter(
    (tooth) => tooth.jaw === 'upper' && tooth.type === FIRST_MOLAR
  );
  return molars.length === 2
    ? Math.abs(molars[0].occlusal[0] - molars[1].occlusal[0])
    : NaN;
}

/**
 * Similarity fit (rotation, translation, one scale) of point lists.
 * @param {number[][]} source
 * @param {number[][]} target
 */
export function similarityFit(source, target) {
  const rigid = rigidFit(source, target);
  const centre = (points) =>
    [0, 1, 2].map(
      (axis) =>
        points.reduce((sum, point) => sum + point[axis], 0) / points.length
    );
  const from = centre(source);
  const to = centre(target);
  const still = { rotation: rigid.rotation, translation: [0, 0, 0] };
  let along = 0;
  let spread = 0;
  source.forEach((point, index) => {
    const turned = transformPoint(
      point.map((value, axis) => value - from[axis]),
      still
    );
    turned.forEach((value, axis) => {
      along += value * (target[index][axis] - to[axis]);
      spread += value * value;
    });
  });
  const scale = spread > 0 ? along / spread : 1;
  const turned = transformPoint(from, { ...still, scale });
  return {
    rotation: rigid.rotation,
    translation: to.map((value, axis) => value - turned[axis]),
    scale,
  };
}

const fits = new WeakMap();

/**
 * Transform from a source's millimetres into a head's frame (cm).
 * @param {object} source
 * @param {Record<string, number>} head
 * @param {{fit?: string[], scale?: boolean}} [options] Key points the fit
 *   uses (DENTAL_KEY_POINTS by default) and whether the source is scaled
 *   to the head.
 */
export function fitAnatomySource(source, head, options = {}) {
  const config = normalizeHeadConfig(head);
  const key = JSON.stringify([config, options.fit, Boolean(options.scale)]);
  let cache = fits.get(source);
  if (!cache) {
    cache = new Map();
    fits.set(source, cache);
  }
  if (cache.has(key)) {
    return cache.get(key);
  }
  const target = modelKeyPoints(config);
  const names = (options.fit ?? DENTAL_KEY_POINTS).filter(
    (name) =>
      KEY_POINTS.includes(name) &&
      source.keyPoints[name]?.every(Number.isFinite) &&
      target[name]?.every(Number.isFinite)
  );
  if (names.length < 3) {
    throw new Error(
      `Source "${source.name}" shares only ${names.length} key points with the model (needs 3)`
    );
  }
  const from = names.map((name) => source.keyPoints[name]);
  const to = names.map((name) => target[name]);
  const fit = options.scale ? similarityFit(from, to) : rigidFit(from, to);
  const transform = {
    rotation: fit.rotation,
    translation: fit.translation.map((value) => value * MM),
    scale: (fit.scale ?? 1) * MM,
  };
  if (cache.size >= 16) {
    cache.clear();
  }
  cache.set(key, transform);
  return transform;
}

const reduced = new WeakMap();

/** A source part reduced to an anatomy LOD (cached per mesh and LOD). */
function sourcePart(mesh, lod) {
  let levels = reduced.get(mesh);
  if (!levels) {
    levels = [];
    reduced.set(mesh, levels);
  }
  levels[lod] ??= clusterVertices(mesh, SOURCE_LOD_CELLS[lod]);
  return levels[lod];
}

/**
 * The articulator meshes of a head, each from the source chosen for it.
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object, shape?: object,
 *   anatomy?: string|Record<string, string|object>, scale?: boolean,
 *   fit?: string[]}} [options] `anatomy` selects sources (see
 *   anatomySelection); the rest as anatomyMeshes() and fitAnatomySource().
 * @returns {{name: string, source: string, positions: Float32Array, indices: Uint32Array}[]}
 */
export function composeAnatomy(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const selection = anatomySelection(options.anatomy);
  const lod = anatomyLod(options.lod);
  const shape = options.shape ?? tractShape(options.state ?? {}, config);
  const procedural = anatomyMeshes(config, { ...options, shape });
  const gap = shape.teeth?.gap;
  return procedural.map((part) => {
    const source = selection[part.name];
    if (!source) {
      return { ...part, source: PROCEDURAL };
    }
    const mesh = source.parts[part.name];
    if (!mesh) {
      throw new Error(`Source "${source.name}" has no ${part.name}`);
    }
    const placed = transformMesh(
      sourcePart(mesh, lod),
      fitAnatomySource(source, config, options)
    );
    if (part.name === 'lowerTeeth' && gap !== undefined) {
      const { move } = jawPose(gap, config);
      const { positions } = placed;
      for (let index = 0; index < positions.length; index += 3) {
        positions.set(
          move(Array.from(positions.subarray(index, index + 3))),
          index
        );
      }
    }
    return {
      name: part.name,
      source: source.name,
      positions: Float32Array.from(placed.positions),
      indices: Uint32Array.from(placed.indices),
    };
  });
}

/**
 * Head parameters reduced from a source: mouthWidth makes the model's arch
 * as wide between the upper first molars as the source's (it also sets
 * the incisor slot of both solvers). Other parameters are kept.
 * @param {Record<string, number>} head
 * @param {object|string} source
 */
export function sourceHead(head, source) {
  const config = normalizeHeadConfig(head);
  const { archWidth } = resolveSource(source);
  if (!Number.isFinite(archWidth)) {
    return config;
  }
  const widthAt = (mouthWidth) =>
    intermolarWidth(dentalLandmarks({ ...config, mouthWidth }));
  // The arch widens with mouthWidth: bisect within its range.
  let low = getHeadParameter('mouthWidth').min;
  let high = getHeadParameter('mouthWidth').max;
  while (high - low > 1e-3) {
    const middle = (low + high) / 2;
    if (widthAt(middle) < archWidth) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const mouthWidth = (low + high) / 2;
  return normalizeHeadConfig({ ...config, mouthWidth });
}
