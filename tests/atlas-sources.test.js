/**
 * Anatomy sources from the z-up atlases of the Visible Human Japanese male
 * (BodyParts3D and Z-Anatomy): the turn into the head frame, OBJ parsing,
 * the cut of the palate bones and the palate's key points beside the gap
 * at the median suture. The synthetic atlas is the procedural model, its
 * teeth one box per tooth, turned into the atlas frame and named as each
 * atlas names its parts, so reading it back must give the model's key
 * points. The BodyParts3D palate and tongue are read just in time when
 * the network allows.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import {
  BODYPARTS3D_FILES,
  PALATE_BONE_CUT,
  PALATE_SUTURE,
  atlasToHeadFrame,
  bodyParts3dSource,
  bonyPalateKeyPoints,
  cutAbove,
  parseObj,
  zAnatomySource,
} from '../src/geometry/atlas-sources.js';
import { anatomyMeshes, dentalLandmarks } from '../src/geometry/anatomy.js';
import { BODYPARTS3D, fetchAnatomy } from '../scripts/fetch-anatomy.mjs';
import { modelKeyPoints } from '../src/geometry/reference-anatomy.js';
import { REST_GAP } from '../src/articulation/teeth.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { presetHeadConfig } from '../src/head-config.js';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

// Before any test is registered, so CPU-bound tests do not stall the probe.
const offline = await networkSkipReason({ url: BODYPARTS3D.url });

const HEAD = presetHeadConfig('male');
const TOOTH_NAMES = [
  'medial_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar_tooth',
  'second_molar_tooth',
];
/**
 * Length (mm) of the synthetic teeth: short enough that the plane through
 * their centroids is the occlusal plane, as for crowns with their roots.
 */
const TOOTH_LENGTH = 10;

/** Closed box mesh with every face's corners its own vertices. */
function box(centre, size) {
  const corner = (bits) =>
    [0, 1, 2].map(
      (axis) => centre[axis] + (((bits >> axis) & 1) - 0.5) * size[axis]
    );
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return {
    positions: Float64Array.from(faces.flatMap((face) => face.flatMap(corner))),
    indices: Uint32Array.from(
      faces.flatMap((_, face) =>
        [0, 1, 2, 0, 2, 3].map((index) => face * 4 + index)
      )
    ),
  };
}

/**
 * A tooth as a pyramid: its tip at the occlusal point, so that it is the
 * crown's highest vertex, its base TOOTH_LENGTH towards the root.
 */
function pyramid(tip, up, width, thickness) {
  const base = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([across, along]) => [
    tip[0] + (across * width) / 2,
    tip[1] + up * TOOTH_LENGTH,
    tip[2] + (along * thickness) / 2,
  ]);
  return {
    positions: Float64Array.from([...tip, ...base.flat()]),
    indices: Uint32Array.from([
      0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 4, 3, 1, 3, 2,
    ]),
  };
}

/** Head frame (+x right, +y up, +z forward) into the atlas frame. */
function toAtlas(mesh) {
  const positions = new Float64Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = -mesh.positions[index];
    positions[index + 1] = -mesh.positions[index + 2];
    positions[index + 2] = mesh.positions[index + 1];
  }
  return { ...mesh, positions };
}

/** The procedural model as a z-up atlas, its parts named by `name`. */
function syntheticAtlas(name) {
  const teeth = dentalLandmarks(HEAD).map((tooth) => ({
    name: name.tooth(tooth),
    ...pyramid(
      tooth.occlusal,
      tooth.jaw === 'upper' ? 1 : -1,
      tooth.width * 0.9,
      tooth.thickness
    ),
  }));
  const rest = tractShape({}, HEAD);
  const shape = { ...rest, teeth: { ...rest.teeth, gap: REST_GAP } };
  const organs = anatomyMeshes(HEAD, { lod: 3, shape })
    .filter((part) => name[part.name])
    .map((part) => ({
      name: name[part.name],
      positions: Float64Array.from(part.positions, (value) => value * 10),
      indices: part.indices,
    }));
  return [...teeth, ...organs].map(toAtlas);
}

const Z_ANATOMY_NAMES = {
  tooth: ({ jaw, side, type }) =>
    `${jaw === 'upper' ? 'Upper' : 'Lower'}_${TOOTH_NAMES[type]}.${side}`,
  tongue: 'Tongue',
  palate: 'Maxilla.l',
  velum: 'Soft_palate',
};

const BODYPARTS3D_NAMES = {
  tooth: ({ jaw, side, type }) =>
    BODYPARTS3D_FILES[`${jaw}Teeth`][(side === 'l' ? 0 : 7) + type],
  tongue: BODYPARTS3D_FILES.tongue[0],
  palate: BODYPARTS3D_FILES.palate[0],
};

function distance(a, b) {
  return Math.hypot(...a.map((value, axis) => value - b[axis]));
}

/**
 * Two halves of a vault, y = depth·(1 − (x/width)²) for gap ≤ |x| ≤ width
 * and 0 ≤ z ≤ length, open along the midline like the atlases' palates.
 */
function vault(gap, width, depth, length) {
  const positions = [];
  const indices = [];
  const columns = 20;
  const rows = 20;
  for (const sign of [-1, 1]) {
    const first = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const x = sign * (gap + ((width - gap) * column) / columns);
        const z = (length * row) / rows;
        positions.push(x, depth * (1 - (x / width) ** 2), z);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const corner = first + row * (columns + 1) + column;
        indices.push(corner, corner + 1, corner + columns + 2);
        indices.push(corner, corner + columns + 2, corner + columns + 1);
      }
    }
  }
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

describe('atlas frame and files', () => {
  it('turns z-up atlases into the head frame, faces kept outward', () => {
    const [mesh] = atlasToHeadFrame([
      {
        name: 'triangle',
        positions: [1, 2, 3, 2, 2, 3, 1, 3, 3],
        indices: [0, 1, 2],
      },
    ]);
    // Left (+x) becomes -x, anterior (-y) +z, superior (+z) +y.
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([-1, 3, -2]);
    expect(mesh.name).toBe('triangle');
    // The triangle faced +z (up) in the atlas, so it faces +y here.
    const [a, b, c] = Array.from(mesh.indices).map((index) =>
      Array.from(mesh.positions.slice(3 * index, 3 * index + 3))
    );
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0);
  });

  it('parses OBJ faces with texture and normal indices', () => {
    const mesh = parseObj(
      [
        '# a quad and a triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 1 1 0',
        'v 0 1 0',
        'vn 0 0 1',
        'f 1//1 2//1 3//1 4//1',
        'v 0 0 1',
        'f -1/1/1 -5/1/1 -4/1/1',
      ].join('\n')
    );
    expect(mesh.positions.length).toBe(15);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 0, 1]);
  });

  it('keeps the triangles at or below a height', () => {
    const mesh = box([0, 0, 0], [2, 2, 2]);
    const cut = cutAbove(mesh, 0);
    // Only the bottom face lies wholly below the middle.
    expect(cut.indices.length).toBe(6);
    expect(cut.positions.length).toBe(12);
    expect(Math.max(...cut.positions.filter((_, i) => i % 3 === 1))).toBe(-1);
  });
});

describe('bony palate key points', () => {
  it('reads the vault and the back of the palate beside the suture', () => {
    const palate = vault(0.8, 20, 15, 50);
    const points = bonyPalateKeyPoints(palate, 0, 30);
    const height = 15 * (1 - (PALATE_SUTURE / 20) ** 2);
    expect(Math.abs(points.palateVault[1] - height)).toBeLessThan(0.05);
    expect(Math.abs(points.palateVault[2] - 30)).toBeLessThan(0.8);
    expect(points.palateVault[0]).toBe(0);
    expect(Math.abs(points.staphylion[2])).toBeLessThan(1.6);
    expect(Math.abs(points.staphylion[1] - height)).toBeLessThan(0.05);
  });
});

describe('atlas sources from the procedural model', () => {
  const model = modelKeyPoints(HEAD);

  for (const [atlas, names, build] of [
    ['Z-Anatomy', Z_ANATOMY_NAMES, zAnatomySource],
    ['BodyParts3D', BODYPARTS3D_NAMES, bodyParts3dSource],
  ]) {
    it(`gives the model's key points back through ${atlas}`, () => {
      const source = build(syntheticAtlas(names));
      const points = source.keyPoints;
      for (const name of ['upperFirstMolar', 'upperSecondMolar']) {
        expect(distance(points[name], model[name])).toBeLessThan(0.5);
      }
      for (const name of [
        'upperIncisor',
        'lowerIncisor',
        'tongueTip',
        'tongueDorsum',
      ]) {
        expect(distance(points[name], model[name])).toBeLessThan(0.5);
      }
      // Read 1.5 mm beside the midline, where the vault is barely lower.
      expect(distance(points.palateVault, model.palateVault)).toBeLessThan(1);
      expect(distance(points.staphylion, model.staphylion)).toBeLessThan(2);
      expect(source.archWidth).toBeGreaterThan(40);
      // The palate is cut PALATE_BONE_CUT above the vault.
      const heights = source.parts.palate.positions.filter(
        (_, index) => index % 3 === 1
      );
      expect(Math.max(...heights)).toBeLessThan(
        points.palateVault[1] + PALATE_BONE_CUT + 1e-9
      );
      expect(Object.keys(source.parts).includes('velum')).toBe(
        atlas === 'Z-Anatomy'
      );
    });
  }
});

describe('BodyParts3D just in time', () => {
  itUnless(offline)('reads the palate and tongue of the atlas', async () => {
    const output = mkdtempSync(join(tmpdir(), 'bodyparts3d-'));
    try {
      const files = [BODYPARTS3D_FILES.palate[0], BODYPARTS3D_FILES.tongue[0]];
      await fetchAnatomy('bodyparts3d', output, { files });
      const [palate, tongue] = atlasToHeadFrame(
        files.map((file) => ({
          name: file,
          ...parseObj(readFileSync(join(output, `${file}.obj`), 'utf8')),
        }))
      );
      const centre = (mesh, axis) => {
        const values = mesh.positions.filter((_, i) => i % 3 === axis);
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      };
      // In the head frame the tongue lies under the maxilla and behind its
      // front, and the tongue straddles the midline while the left maxilla
      // (FJ3269) lies on the body's left, at -x.
      expect(centre(tongue, 1)).toBeLessThan(centre(palate, 1));
      expect(Math.abs(centre(tongue, 0))).toBeLessThan(5);
      expect(centre(palate, 0)).toBeLessThan(-5);
      const front = Math.max(
        ...palate.positions.filter((_, index) => index % 3 === 2)
      );
      expect(centre(tongue, 2)).toBeLessThan(front);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
