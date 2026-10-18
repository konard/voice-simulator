/**
 * Anatomy sources from the atlases built on the Visible Human Japanese
 * male: BodyParts3D (DBCLS, one OBJ per FMA concept) and Z-Anatomy (its
 * Blender atlas, exported to one STL per object by
 * scripts/blender/z_anatomy_export.py). Both are in millimetres with the
 * body's left at +x, the face towards -y and the head up +z; the head
 * frame has +y up, +z forward and the body's left at -x.
 *
 * Neither atlas segments the mucosa of the hard palate, so their palate
 * is bone: the maxillae and the palatine bones, cut just above the
 * palatal vault so that the sinuses and the orbits stay out. BodyParts3D
 * has no soft palate either (only its muscles), so its velum stays
 * procedural.
 */

import { anatomySource } from './anatomy-sources.js';
import { mergeMeshes } from './loft.js';
import {
  referenceKeyPoints,
  referenceParts,
  sagittalPoints,
} from './reference-anatomy.js';

/** Height (mm) above the palatal vault where the palate bones are cut. */
export const PALATE_BONE_CUT = 8;
/** The atlases leave a gap at the median palatine suture (the palatine
 * bones end 0.8 mm from the midline in Z-Anatomy), so the bony palate is
 * read this far (mm) beside the midline, on both sides. */
export const PALATE_SUTURE = 1.5;
/** Oral side of the palate's back: cut points this far (mm) from its end. */
const BACK_BAND = 1.5;
/** Half-depth (mm) of the band at the first molars that holds the vault. */
const VAULT_BAND = 0.75;

export const Z_ANATOMY_ATLAS = Object.freeze({
  name: 'z-anatomy',
  citation:
    'Gauthier M et al., Z-Anatomy, an open-source 3D atlas of human anatomy built on BodyParts3D, https://www.z-anatomy.com',
  license: 'CC BY-SA 4.0',
});

export const BODYPARTS3D_ATLAS = Object.freeze({
  name: 'bodyparts3d',
  citation:
    'Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K (2009) BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Research 37, D782-D785. doi:10.1093/nar/gkn613',
  license: 'CC BY 4.0, BodyParts3D, (c) The Database Center for Life Science',
});

const TOOTH =
  '(medial_incisor|lateral_incisor|canine|first_premolar|second_premolar|first_molar_tooth|second_molar_tooth)';

/** Z-Anatomy object names (as exported) per role. */
export const Z_ANATOMY_PARTS = Object.freeze({
  upperTeeth: (name) => new RegExp(`^Upper_${TOOTH}\\.[lr]$`, 'u').test(name),
  lowerTeeth: (name) => new RegExp(`^Lower_${TOOTH}\\.[lr]$`, 'u').test(name),
  palate: (name) => /^(Maxilla|Palatine_bone)\.[lr]$/u.test(name),
  velum: (name) => name === 'Soft_palate' || name === 'Uvula_of_palate',
  tongue: (name) => name === 'Tongue',
  arytenoids: (name) => /^Arytenoid_cartilage\.[lr]$/u.test(name),
  thyroid: (name) => name === 'Thyroid_cartilage',
});

/**
 * BodyParts3D 4.0 element files (is-a tree) per role, from its
 * isa_element_parts.txt: the permanent teeth from the central incisor to
 * the second molar, the tongue, the maxillae and palatine bones, the
 * arytenoid and thyroid cartilages.
 */
export const BODYPARTS3D_FILES = Object.freeze({
  upperTeeth: Object.freeze([
    'FJ1265',
    'FJ1266',
    'FJ1267',
    'FJ1262',
    'FJ1264',
    'FJ1261',
    'FJ1263',
    'FJ1279',
    'FJ1280',
    'FJ1281',
    'FJ1277',
    'FJ1278',
    'FJ1276',
    'FJ1275',
  ]),
  lowerTeeth: Object.freeze([
    'FJ1258',
    'FJ1259',
    'FJ1260',
    'FJ1255',
    'FJ1257',
    'FJ1254',
    'FJ1256',
    'FJ1272',
    'FJ1273',
    'FJ1274',
    'FJ1269',
    'FJ1271',
    'FJ1268',
    'FJ1270',
  ]),
  tongue: Object.freeze(['FJ2761']),
  palate: Object.freeze(['FJ3269', 'FJ3375', 'FJ3273', 'FJ3379']),
  arytenoids: Object.freeze(['FJ2775', 'FJ2792']),
  thyroid: Object.freeze(['FJ2808']),
});

export const BODYPARTS3D_PARTS = Object.freeze(
  Object.fromEntries(
    Object.entries(BODYPARTS3D_FILES).map(([role, files]) => [
      role,
      (name) => files.includes(name),
    ])
  )
);

/**
 * Meshes of a z-up atlas (+x left, -y anterior, +z superior) in the head
 * frame (+x right, +y up, +z forward), their faces kept outward.
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 */
export function atlasToHeadFrame(meshes) {
  return meshes.map((mesh) => {
    const positions = new Float64Array(mesh.positions.length);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = -mesh.positions[index];
      positions[index + 1] = mesh.positions[index + 2];
      positions[index + 2] = -mesh.positions[index + 1];
    }
    // The map has determinant -1, so the winding is reversed to keep the
    // normals pointing out.
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

/**
 * The triangles of a mesh lying wholly at or below a height, the unused
 * vertices dropped.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number} height
 */
export function cutAbove(mesh, height) {
  const remap = new Map();
  const positions = [];
  const indices = [];
  const below = (vertex) => mesh.positions[3 * vertex + 1] <= height;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const corners = [0, 1, 2].map((corner) => mesh.indices[index + corner]);
    if (!corners.every(below)) {
      continue;
    }
    for (const vertex of corners) {
      if (!remap.has(vertex)) {
        remap.set(vertex, positions.length / 3);
        positions.push(
          mesh.positions[3 * vertex],
          mesh.positions[3 * vertex + 1],
          mesh.positions[3 * vertex + 2]
        );
      }
      indices.push(remap.get(vertex));
    }
  }
  return {
    ...mesh,
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

function lowest(points) {
  return points.reduce((a, b) => (b[1] < a[1] ? b : a), [NaN, Infinity, NaN]);
}

/**
 * Staphylion (the oral end of the posterior nasal spine) and palatal
 * vault of a bony palate, read on parasagittal cuts PALATE_SUTURE beside
 * the midline and averaged over both sides (mm, head frame).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} palate
 * @param {number} midline
 * @param {number} molarDepth z of the upper first molars.
 */
export function bonyPalateKeyPoints(palate, midline, molarDepth) {
  const sides = [-1, 1].map((sign) => {
    const points = sagittalPoints(palate, midline + sign * PALATE_SUTURE);
    const back = Math.min(...points.map((point) => point[2]));
    return {
      staphylion: lowest(
        points.filter((point) => point[2] <= back + BACK_BAND)
      ),
      palateVault: lowest(
        points.filter((point) => Math.abs(point[2] - molarDepth) <= VAULT_BAND)
      ),
    };
  });
  const middle = (name) => [
    midline,
    (sides[0][name][1] + sides[1][name][1]) / 2,
    (sides[0][name][2] + sides[1][name][2]) / 2,
  ];
  return {
    staphylion: middle('staphylion'),
    palateVault: middle('palateVault'),
  };
}

/**
 * An anatomy source from a z-up atlas: its meshes turned into the head
 * frame, the key points measured on the whole bones (the palate's by
 * bonyPalateKeyPoints()), and the palate bones cut PALATE_BONE_CUT above
 * the vault.
 * @param {{name: string, citation: string, license: string}} atlas
 *   Z_ANATOMY_ATLAS, BODYPARTS3D_ATLAS or another atlas in their frame.
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 * @param {Record<string, (name: string) => boolean>} roles
 */
export function atlasSource(atlas, meshes, roles) {
  const head = atlasToHeadFrame(meshes);
  const parts = referenceParts(head, roles);
  const measured = referenceKeyPoints(parts);
  const keyPoints = parts.palate?.length
    ? {
        ...measured,
        ...bonyPalateKeyPoints(
          mergeMeshes(parts.palate),
          measured.midline,
          measured.upperFirstMolar[2]
        ),
      }
    : measured;
  const cut = keyPoints.palateVault[1] + PALATE_BONE_CUT;
  const trimmed = head.map((mesh) =>
    roles.palate?.(mesh.name) ? cutAbove(mesh, cut) : mesh
  );
  return anatomySource(atlas.name, trimmed, {
    roles,
    keyPoints,
    citation: atlas.citation,
    license: atlas.license,
  });
}

/** The Z-Anatomy source from the STLs z_anatomy_export.py writes. */
export function zAnatomySource(meshes) {
  return atlasSource(Z_ANATOMY_ATLAS, meshes, Z_ANATOMY_PARTS);
}

/** The BodyParts3D source from its element OBJs, named by file id. */
export function bodyParts3dSource(meshes) {
  return atlasSource(BODYPARTS3D_ATLAS, meshes, BODYPARTS3D_PARTS);
}

/**
 * A Wavefront OBJ file as one mesh (polygons fanned into triangles).
 * @param {string} text
 * @returns {{positions: Float64Array, indices: Uint32Array}}
 */
export function parseObj(text) {
  const positions = [];
  const indices = [];
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields[0] === 'v') {
      positions.push(Number(fields[1]), Number(fields[2]), Number(fields[3]));
    } else if (fields[0] === 'f') {
      const count = positions.length / 3;
      const corners = fields.slice(1).map((field) => {
        const vertex = Number.parseInt(field, 10);
        return vertex < 0 ? count + vertex : vertex - 1;
      });
      for (let corner = 1; corner + 1 < corners.length; corner++) {
        indices.push(corners[0], corners[corner], corners[corner + 1]);
      }
    }
  }
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}
