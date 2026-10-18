/**
 * Key points of segmented reference anatomy and of the head model, found
 * the same way on both: each part is cut in the midsagittal plane, as an
 * MRI slice would show it, and the landmarks are read off the cuts and
 * the teeth. A rigid fit of one set onto the other then gives the
 * distance between every pair of landmarks.
 *
 * Parts are triangle meshes in millimetres in a head frame (+y up, +z
 * forward); `x` is the midline of a reference and 0 for the model. The
 * landmarks:
 *
 *   upperIncisor, lowerIncisor  middle of the central incisors' edges
 *   upperFirstMolar, upperSecondMolar  middle of the molar pair's
 *                               occlusal points
 *   staphylion                  back of the hard palate on its oral side
 *                               (posterior nasal spine)
 *   palateVault                 oral palate above the first molars
 *   uvula                       lowest point of the soft palate
 *   tongueTip, tongueDorsum     most forward and highest midline tongue
 *   glottis                     middle of the glottis
 */

import { arcPoint, tractCenterline } from './centerline.js';
import { TOOTH_TYPES, toothLandmarks } from './dental.js';
import { axisPlane, sliceMesh } from './slice.js';
import { anatomyMeshes, dentalLandmarks } from './anatomy.js';
import { rigidFit, transformPoint } from './align.js';
import { mergeMeshes } from './loft.js';
import { normalizeHeadConfig } from '../head-config.js';

/** Landmark names in the order compareKeyPoints() reports them. */
export const KEY_POINTS = Object.freeze([
  'upperIncisor',
  'lowerIncisor',
  'upperFirstMolar',
  'upperSecondMolar',
  'staphylion',
  'palateVault',
  'uvula',
  'tongueTip',
  'tongueDorsum',
  'glottis',
]);

const FIRST_MOLAR = 5;
const SECOND_MOLAR = 6;
/** Half-width (mm) of the band of cut points read at a given depth. */
const BAND = 0.75;
/** Oral side of the palate's back: cut points this far (mm) from its end. */
const BACK_BAND = 1.5;
/** The midsagittal cut runs this far (mm) beside the midline so it does
 * not pass through the vertices of meshes mirrored about it. */
const MIDLINE_OFFSET = -0.05;
/** Share of an arytenoid's height, from its base, that holds the vocal
 * process. */
const VOCAL_PROCESS_BAND = 0.4;
/** Crown height (mm) over which labialLean() reads the labial face, and
 * the band at the incisal edge it leaves out (the edge is rounded). */
const LABIAL_CROWN = 9;
const LABIAL_START = 0.5;
/** Half-width (mm) of the band about the midline that holds the middle of
 * the model's central incisors. */
const MIDLINE_BAND = 3;

const mean = (points) =>
  [0, 1, 2].map(
    (axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length
  );

/**
 * Connected shells of a mesh, with vertices at the same position welded
 * (exporters split vertices along texture seams).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number} [tolerance] Weld distance in the mesh's units.
 * @returns {{positions: Float64Array, indices: Uint32Array}[]} Largest first.
 */
export function meshShells({ positions, indices }, tolerance = 1e-4) {
  const count = positions.length / 3;
  const welded = new Map();
  const parent = Int32Array.from({ length: count }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const join = (a, b) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) {
      parent[rb] = ra;
    }
  };
  for (let index = 0; index < count; index++) {
    const key = [0, 1, 2]
      .map((axis) => Math.round(positions[index * 3 + axis] / tolerance))
      .join(',');
    if (welded.has(key)) {
      join(welded.get(key), index);
    } else {
      welded.set(key, index);
    }
  }
  for (let index = 0; index < indices.length; index += 3) {
    join(indices[index], indices[index + 1]);
    join(indices[index], indices[index + 2]);
  }
  // One pass over vertices and one over triangles, sorted by shell root.
  const shellOf = new Map();
  const local = new Int32Array(count);
  const shells = [];
  for (let index = 0; index < count; index++) {
    const root = find(index);
    let shell = shellOf.get(root);
    if (!shell) {
      shell = { vertices: [], triangles: [] };
      shellOf.set(root, shell);
      shells.push(shell);
    }
    local[index] = shell.vertices.length;
    shell.vertices.push(index);
  }
  for (let index = 0; index < indices.length; index += 3) {
    const { triangles } = shellOf.get(find(indices[index]));
    for (let corner = 0; corner < 3; corner++) {
      triangles.push(local[indices[index + corner]]);
    }
  }
  return shells
    .map(({ vertices, triangles }) => {
      const shellPositions = new Float64Array(vertices.length * 3);
      vertices.forEach((vertex, at) => {
        for (let axis = 0; axis < 3; axis++) {
          shellPositions[at * 3 + axis] = positions[vertex * 3 + axis];
        }
      });
      return {
        positions: shellPositions,
        indices: Uint32Array.from(triangles),
      };
    })
    .sort((a, b) => b.positions.length - a.positions.length);
}

function centroid({ positions }) {
  const sum = [0, 0, 0];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      sum[axis] += positions[index + axis];
    }
  }
  return sum.map((value) => value / (positions.length / 3));
}

/**
 * Teeth of one arch, one shell per tooth, sorted into sides and types:
 * the midline runs between the two most forward crowns and on each side
 * the teeth follow one another backwards along the arch. Third molars, the
 * eighth tooth of a side, are left out like in TOOTH_TYPES.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}[]} shells
 * @param {'upper'|'lower'} jaw
 * @param {{leftSign?: number}} [options] Sign of x on the body's left
 *   (the model's left is at -x).
 */
export function classifyTeeth(shells, jaw, options = {}) {
  const leftSign = options.leftSign ?? -1;
  const located = shells.map((shell) => ({ shell, centre: centroid(shell) }));
  const front = [...located].sort((a, b) => b.centre[2] - a.centre[2]);
  const midline = (front[0].centre[0] + front[1].centre[0]) / 2;
  return ['l', 'r'].flatMap((side) => {
    const sign = side === 'l' ? leftSign : -leftSign;
    const teeth = located.filter(
      ({ centre }) => (centre[0] - midline) * sign > 0
    );
    // Walk the arch: always the nearest tooth not yet taken, from the front.
    const ordered = [];
    let current = teeth.reduce((a, b) => (b.centre[2] > a.centre[2] ? b : a));
    while (current) {
      ordered.push(current);
      const last = current.centre;
      current = teeth
        .filter((tooth) => !ordered.includes(tooth))
        .reduce(
          (best, tooth) =>
            !best ||
            Math.hypot(...tooth.centre.map((v, a) => v - last[a])) <
              Math.hypot(...best.centre.map((v, a) => v - last[a]))
              ? tooth
              : best,
          null
        );
    }
    return ordered.slice(0, TOOTH_TYPES.length).map(({ shell }, type) => ({
      jaw,
      side,
      type,
      positions: shell.positions,
    }));
  });
}

/** Points of the cut of a mesh with the plane x = `midline`. */
export function midsagittalPoints(mesh, midline = 0) {
  return sliceMesh(mesh, axisPlane(0, midline + MIDLINE_OFFSET)).flat();
}

function occlusalMiddle(landmarks, jaw, type) {
  return mean(
    landmarks
      .filter((tooth) => tooth.jaw === jaw && tooth.type === type)
      .map((tooth) => tooth.occlusal)
  );
}

function lowestAt(points, z) {
  const band = points.filter((point) => Math.abs(point[2] - z) <= BAND);
  return band.length
    ? band.reduce((a, b) => (b[1] < a[1] ? b : a))
    : [NaN, NaN, NaN];
}

function extreme(points, axis, sign) {
  return points.length
    ? points.reduce((a, b) => (sign * b[axis] > sign * a[axis] ? b : a))
    : [NaN, NaN, NaN];
}

/**
 * Landmarks of a mouth from its parts (mm, head frame).
 * @param {{upperTeeth: object[], lowerTeeth: object[], palate: object,
 *   velum: object, tongue: object[], glottis: number[]}} parts Teeth are
 *   sorted teeth (classifyTeeth or the model's), tongue a list of meshes.
 * @param {number} [midline] x of the midsagittal plane.
 * @returns {Record<string, number[]>}
 */
export function mouthKeyPoints(parts, midline = 0) {
  const landmarks = [...parts.upperTeeth, ...parts.lowerTeeth].every(
    (tooth) => tooth.occlusal
  )
    ? [...parts.upperTeeth, ...parts.lowerTeeth]
    : toothLandmarks([...parts.upperTeeth, ...parts.lowerTeeth]);
  const upperFirstMolar = occlusalMiddle(landmarks, 'upper', FIRST_MOLAR);
  const palate = midsagittalPoints(parts.palate, midline);
  const back = extreme(palate, 2, -1)[2];
  const staphylion = extreme(
    palate.filter((point) => point[2] <= back + BACK_BAND),
    1,
    -1
  );
  const tongue = parts.tongue.flatMap((mesh) =>
    midsagittalPoints(mesh, midline)
  );
  return {
    upperIncisor: occlusalMiddle(landmarks, 'upper', 0),
    lowerIncisor: occlusalMiddle(landmarks, 'lower', 0),
    upperFirstMolar,
    upperSecondMolar: occlusalMiddle(landmarks, 'upper', SECOND_MOLAR),
    staphylion,
    palateVault: lowestAt(palate, upperFirstMolar[2]),
    uvula: extreme(midsagittalPoints(parts.velum, midline), 1, -1),
    tongueTip: extreme(tongue, 2, 1),
    tongueDorsum: extreme(tongue, 1, 1),
    glottis: parts.glottis,
  };
}

/**
 * Middle of the glottis of a segmented larynx: halfway between the tips
 * of the arytenoids' vocal processes (the most forward points of their
 * bases) and the inner face of the thyroid cartilage at that height.
 * @param {{arytenoids: object[], thyroid: object}} larynx Meshes in mm.
 */
export function glottisPoint({ arytenoids, thyroid }) {
  const tips = arytenoids.map(({ positions }) => {
    const heights = positions.filter((_, index) => index % 3 === 1);
    const low = Math.min(...heights);
    const top = low + VOCAL_PROCESS_BAND * (Math.max(...heights) - low);
    let best = null;
    for (let index = 0; index < positions.length; index += 3) {
      if (
        positions[index + 1] <= top &&
        (!best || positions[index + 2] > best[2])
      ) {
        best = Array.from(positions.subarray(index, index + 3));
      }
    }
    return best;
  });
  const back = mean(tips);
  const cut = midsagittalPoints(thyroid, back[0]).filter(
    (point) => Math.abs(point[1] - back[1]) <= 2 * BAND
  );
  const inner = extreme(cut, 2, -1);
  return mean([back, [back[0], back[1], inner[2]]]);
}

/**
 * The model's landmarks for a head at rest (mm, head frame).
 * @param {Record<string, number>} head
 */
export function modelKeyPoints(head) {
  const config = normalizeHeadConfig(head);
  const parts = Object.fromEntries(
    anatomyMeshes(config, { lod: 3 }).map((part) => [
      part.name,
      {
        positions: Float64Array.from(part.positions, (value) => value * 10),
        indices: part.indices,
      },
    ])
  );
  const landmarks = dentalLandmarks(config);
  const glottis = arcPoint(0, tractCenterline(config).layout).point;
  return mouthKeyPoints({
    upperTeeth: landmarks.filter((tooth) => tooth.jaw === 'upper'),
    lowerTeeth: landmarks.filter((tooth) => tooth.jaw === 'lower'),
    palate: parts.palate,
    velum: parts.velum,
    tongue: [parts.tongue],
    glottis: glottis.map((value) => value * 10),
  });
}

/**
 * Rigid fit of the model's landmarks onto a reference's and the distance
 * (mm) between every pair after the fit.
 * @param {Record<string, number[]>} model
 * @param {Record<string, number[]>} reference
 * @param {{fit?: string[]}} [options] Landmarks the fit uses (default:
 *   all that both have).
 */
export function compareKeyPoints(model, reference, options = {}) {
  const shared = KEY_POINTS.filter(
    (name) =>
      model[name]?.every(Number.isFinite) &&
      reference[name]?.every(Number.isFinite)
  );
  const fitted = (options.fit ?? shared).filter((name) =>
    shared.includes(name)
  );
  const transform = rigidFit(
    fitted.map((name) => model[name]),
    fitted.map((name) => reference[name])
  );
  const distances = Object.fromEntries(
    shared.map((name) => {
      const moved = transformPoint(model[name], transform);
      return [
        name,
        Math.hypot(
          ...moved.map((value, axis) => value - reference[name][axis])
        ),
      ];
    })
  );
  return { transform, distances, rms: transform.rms, fitted };
}

/**
 * Parts of the HuBMAP HRA reference mouth and larynx (Visible Human male
 * and female, Schlehlein et al. 2024) by the role they play here, as a
 * test on their node names (VH_M_ or VH_F_ prefixed).
 */
export const HRA_PARTS = Object.freeze({
  upperTeeth: (name) => name.endsWith('set_of_upper_jaw_teeth'),
  lowerTeeth: (name) => name.endsWith('set_of_lower_jaw_teeth'),
  palate: (name) => name.endsWith('hard_palate'),
  velum: (name) => name.endsWith('mucosa_of_soft_palate'),
  tongue: (name) => /_(dorsal|ventral|posterior_part_of)_tongue$/u.test(name),
  arytenoids: (name) => /_arytenoid_cartilage_[LR]$/u.test(name),
  thyroid: (name) => name.endsWith('thyroid_cartilage'),
});

/**
 * Meshes of a segmented reference sorted into roles.
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 * @param {Record<string, (name: string) => boolean>} [roles] A test on
 *   the mesh name per role (HRA_PARTS by default).
 * @returns {Record<string, object[]>}
 */
export function referenceParts(meshes, roles = HRA_PARTS) {
  return Object.fromEntries(
    Object.entries(roles).map(([role, test]) => [
      role,
      meshes.filter((mesh) => test(mesh.name)),
    ])
  );
}

/**
 * Teeth of a segmented reference, one shell per tooth (crown and root),
 * sorted into jaws, sides and types by classifyTeeth(); a jaw with fewer
 * than two shells gives none.
 * @param {Record<string, object[]>} parts From referenceParts().
 */
export function sortedReferenceTeeth(parts) {
  return ['upper', 'lower'].flatMap((jaw) => {
    const shells = (parts[`${jaw}Teeth`] ?? []).flatMap((mesh) =>
      meshShells(mesh)
    );
    return shells.length >= 2 ? classifyTeeth(shells, jaw) : [];
  });
}

/**
 * Tooth landmarks (toothLandmarks()) of a segmented reference's arches,
 * split into crowns and sorted by jaw, side and type.
 * @param {Record<string, object[]>} parts From referenceParts().
 */
export function referenceTeeth(parts) {
  const sorted = sortedReferenceTeeth(parts);
  return sorted.length >= 3 ? toothLandmarks(sorted) : [];
}

/**
 * Lean of a tooth's long axis in the sagittal plane: the principal axis of
 * its vertices from vertical, positive when its upper end leans forward
 * (degrees). An upper incisor with its edge forward of its root leans
 * negative, a lower incisor with its edge forward positive.
 * @param {ArrayLike<number>} positions mm, +y up, +z forward.
 */
export function sagittalLean(positions) {
  const count = positions.length / 3;
  let [up, forward] = [0, 0];
  for (let index = 0; index < positions.length; index += 3) {
    up += positions[index + 1] / count;
    forward += positions[index + 2] / count;
  }
  let [upUp, forwardForward, upForward] = [0, 0, 0];
  for (let index = 0; index < positions.length; index += 3) {
    const u = positions[index + 1] - up;
    const f = positions[index + 2] - forward;
    upUp += u * u;
    forwardForward += f * f;
    upForward += u * f;
  }
  return (
    (0.5 * Math.atan2(2 * upForward, upUp - forwardForward) * 180) / Math.PI
  );
}

/**
 * Lean of the labial face of an incisor crown from vertical (degrees,
 * positive when its upper end leans forward): the most forward point of
 * every 1 mm band from the incisal edge up (or down) the crown, fitted
 * with a line. Unlike sagittalLean() it needs no root, so it measures the
 * model's crowns and segmented teeth alike.
 * @param {ArrayLike<number>} positions mm, +y up, +z forward.
 * @param {'upper'|'lower'} jaw
 * @param {{crown?: number}} [options] Crown height read (mm).
 */
export function labialLean(positions, jaw, options = {}) {
  const crown = options.crown ?? LABIAL_CROWN;
  const sign = jaw === 'upper' ? 1 : -1;
  let edge = Infinity;
  for (let index = 1; index < positions.length; index += 3) {
    edge = Math.min(edge, sign * positions[index]);
  }
  const front = new Map();
  for (let index = 0; index < positions.length; index += 3) {
    const rise = sign * positions[index + 1] - edge;
    if (rise >= LABIAL_START && rise <= crown) {
      const band = Math.round(rise);
      front.set(
        band,
        Math.max(front.get(band) ?? -Infinity, positions[index + 2])
      );
    }
  }
  const points = [...front].map(([rise, z]) => [sign * rise, z]);
  const [up, forward] = [0, 1].map(
    (axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length
  );
  const slope =
    points.reduce((sum, [y, z]) => sum + (y - up) * (z - forward), 0) /
    points.reduce((sum, [y]) => sum + (y - up) ** 2, 0);
  return (Math.atan(slope) * 180) / Math.PI;
}

/**
 * Mean lean (degrees) of the central incisors of each jaw.
 * @param {{jaw: string, type: number, positions: ArrayLike<number>}[]} teeth
 * @param {(tooth: object) => number} [measure] sagittalLean of the whole
 *   tooth by default.
 */
export function incisorLean(
  teeth,
  measure = (tooth) => sagittalLean(tooth.positions)
) {
  return Object.fromEntries(
    ['upper', 'lower'].map((jaw) => {
      const leans = teeth
        .filter((tooth) => tooth.jaw === jaw && tooth.type === 0)
        .map(measure);
      return [jaw, leans.reduce((sum, lean) => sum + lean, 0) / leans.length];
    })
  );
}

/**
 * Labial-face lean (degrees, see labialLean) of the model's central
 * incisors at rest: the vertices of each arch within MIDLINE_BAND of the
 * midline, in mm.
 * @param {Record<string, number>} head
 */
export function modelIncisorLean(head) {
  const parts = anatomyMeshes(normalizeHeadConfig(head), { lod: 3 });
  return Object.fromEntries(
    ['upper', 'lower'].map((jaw) => {
      const { positions } = parts.find((part) => part.name === `${jaw}Teeth`);
      const near = [];
      for (let index = 0; index < positions.length; index += 3) {
        if (Math.abs(positions[index]) * 10 < MIDLINE_BAND) {
          near.push(
            positions[index] * 10,
            positions[index + 1] * 10,
            positions[index + 2] * 10
          );
        }
      }
      return [jaw, labialLean(near, jaw)];
    })
  );
}

/**
 * Clinical distances (mm) between key points: upper incisor to the
 * posterior nasal spine, the velum's chord from there to the uvula,
 * overjet and overbite (positive when the upper incisors overlap the
 * lower ones), the tongue's dorsum above the upper incisal edge, the
 * palatal vault above the first molars' occlusal plane and the glottis
 * below the posterior nasal spine.
 * @param {Record<string, number[]>} points From a *KeyPoints() function.
 */
export function keyPointMeasures(points) {
  const distance = (a, b) =>
    Math.hypot(...[1, 2].map((axis) => points[a][axis] - points[b][axis]));
  const { upperIncisor, lowerIncisor } = points;
  return {
    incisorToStaphylion: distance('upperIncisor', 'staphylion'),
    velumChord: distance('staphylion', 'uvula'),
    overjet: upperIncisor[2] - lowerIncisor[2],
    overbite: lowerIncisor[1] - upperIncisor[1],
    dorsumHeight: points.tongueDorsum[1] - upperIncisor[1],
    palateHeight: points.palateVault[1] - points.upperFirstMolar[1],
    glottisDepth: points.staphylion[1] - points.glottis[1],
  };
}

/**
 * Landmarks of a segmented reference (mm, head frame with the body's left
 * at -x, like the model), on its midsagittal plane: the teeth are split
 * into crowns, the midline runs between the central incisors and the
 * larynx gives the glottis.
 * @param {Record<string, object[]>} parts From referenceParts().
 */
export function referenceKeyPoints(parts) {
  const landmarks = referenceTeeth(parts);
  const midline = mean(
    landmarks.filter((tooth) => tooth.type === 0).map((tooth) => tooth.occlusal)
  )[0];
  const glottis =
    parts.arytenoids?.length && parts.thyroid?.length
      ? glottisPoint({
          arytenoids: parts.arytenoids,
          thyroid: mergeMeshes(parts.thyroid),
        })
      : [NaN, NaN, NaN];
  const points = mouthKeyPoints(
    {
      upperTeeth: landmarks.filter((tooth) => tooth.jaw === 'upper'),
      lowerTeeth: landmarks.filter((tooth) => tooth.jaw === 'lower'),
      palate: mergeMeshes(parts.palate ?? []),
      velum: mergeMeshes(parts.velum ?? []),
      tongue: parts.tongue ?? [],
      glottis,
    },
    midline
  );
  // Compared in the midsagittal plane, as on an MRI slice: the model is
  // symmetric, references are not (the HRA female larynx lies 9 mm to the
  // right of her incisors).
  return {
    midline,
    ...Object.fromEntries(
      Object.entries(points).map(([name, point]) => [
        name,
        [midline, point[1], point[2]],
      ])
    ),
  };
}

/**
 * Mirror meshes in x (a frame with the body's left at +x into the head
 * frame), keeping their faces outward.
 */
export function mirrorX(meshes) {
  return meshes.map((mesh) => {
    const positions = Float64Array.from(mesh.positions, (value, index) =>
      index % 3 === 0 ? -value : value
    );
    const indices = Uint32Array.from(mesh.indices);
    for (let index = 0; index < indices.length; index += 3) {
      [indices[index + 1], indices[index + 2]] = [
        indices[index + 2],
        indices[index + 1],
      ];
    }
    return { ...mesh, positions, indices };
  });
}
