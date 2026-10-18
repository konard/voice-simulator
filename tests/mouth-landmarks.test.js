/**
 * Mouths read the way MRI is read (src/geometry/mouth-landmarks.js), the
 * glTF reader and tooth splitting that bring segmented and modelled mouths
 * into it (src/geometry/gltf-read.js, src/geometry/tooth-row.js), and the
 * procedural mouth held to the Human Reference Atlas mouths
 * (tests/fixtures/anatomy/mouth-landmarks.json, rebuilt by
 * scripts/build-mouth-reference.mjs from the just-in-time downloads of
 * scripts/fetch-anatomy.mjs).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { meshesToGlb } from '../src/geometry/gltf.js';
import {
  GLB_HEADER_BYTES,
  accessorSpan,
  glbBinaryOffset,
  glbJsonLength,
  gltfMeshes,
  meshAccessors,
  readGlb,
} from '../src/geometry/gltf-read.js';
import {
  compareLandmarks,
  mergeMeshes,
  midlineOf,
  modelMouthParts,
  mouthLandmarks,
  mouthMeasures,
  slabPoints,
} from '../src/geometry/mouth-landmarks.js';
import {
  connectedPieces,
  numberTeeth,
  sagittalLean,
} from '../src/geometry/tooth-row.js';
import { presetHeadConfig } from '../src/head-config.js';
import { measureMouth } from '../scripts/build-mouth-reference.mjs';
import {
  HRA_MOUTH,
  fetchAnatomy,
  fetchHraMouth,
} from '../scripts/fetch-anatomy.mjs';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

// Before any test is registered, so CPU-bound tests do not stall the probe.
const offline = await networkSkipReason({ url: HRA_MOUTH['hra-male'].url });

const FIXTURE = JSON.parse(
  readFileSync(
    new globalThis.URL(
      './fixtures/anatomy/mouth-landmarks.json',
      import.meta.url
    )
  )
);
/** Landmarks the model is fitted on: the bony and dental ones. */
const FIT = ['upperIncisor', 'lowerIncisor', 'staphylion', 'uvula'];

const near = (actual, expected, tolerance) =>
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);

/** Closed axis-aligned box mesh, `size` = [x, y, z], centred at `centre`. */
function box(centre, size) {
  const positions = [];
  for (let corner = 0; corner < 8; corner++) {
    for (let axis = 0; axis < 3; axis++) {
      const sign = (corner >> axis) & 1 ? 0.5 : -0.5;
      positions.push(centre[axis] + sign * size[axis]);
    }
  }
  // Two triangles per face; corner bits are x = 1, y = 2, z = 4.
  const faces = [
    [0, 2, 6, 4],
    [1, 5, 7, 3],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 1, 3, 2],
    [4, 6, 7, 5],
  ];
  const indices = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: Float32Array.from(positions), indices };
}

/** GLB bytes with the JSON chunk replaced by edit(json). */
function editGlb(bytes, edit) {
  const jsonLength = glbJsonLength(bytes);
  const json = JSON.parse(
    new globalThis.TextDecoder().decode(
      bytes.subarray(GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength)
    )
  );
  const binary = bytes.subarray(glbBinaryOffset(jsonLength) - 8);
  const text = new globalThis.TextEncoder().encode(JSON.stringify(edit(json)));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(GLB_HEADER_BYTES + padded + binary.length);
  const view = new DataView(out.buffer);
  out.set(bytes.subarray(0, GLB_HEADER_BYTES));
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  out.set(text, GLB_HEADER_BYTES);
  out.fill(0x20, GLB_HEADER_BYTES + text.length, GLB_HEADER_BYTES + padded);
  out.set(binary, GLB_HEADER_BYTES + padded);
  return out;
}

/**
 * A mouth of boxes (mm, +z forward): incisors at the front, the hard palate
 * behind and above them, the velum hanging from its back and the tongue
 * below.
 */
function boxMouth() {
  return {
    upperTeeth: box([0, 5, 95], [30, 10, 8]),
    lowerTeeth: box([0, -6, 93], [26, 10, 7]),
    palate: box([0, 18, 75], [30, 4, 40]),
    velum: box([0, 8, 50], [20, 24, 10]),
    tongue: box([0, -5, 70], [30, 20, 40]),
  };
}

describe('glTF reader', () => {
  it('reads the meshes of nodes through their transforms', () => {
    const square = box([0, 0, 0], [2, 2, 2]);
    const bytes = editGlb(
      meshesToGlb([{ name: 'part', ...square }], { scale: 1 }),
      (json) => ({
        ...json,
        scenes: [{ nodes: [1] }],
        nodes: [
          { ...json.nodes[0], scale: [2, 2, 2], translation: [0, 0, 1] },
          // A quarter turn about y carries +z to +x.
          {
            name: 'parent',
            rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
            translation: [10, 0, 0],
            children: [0],
          },
        ],
      })
    );
    const { meshes } = readGlb(bytes);
    expect(meshes.map((mesh) => mesh.name)).toEqual(['part']);
    const [{ positions, indices }] = meshes;
    expect(Array.from(indices)).toEqual(square.indices);
    // Corner (1, 1, 1) through the child's scale and shift, (2, 2, 3), and
    // the parent's turn and shift: (13, 2, -2).
    const corner = Array.from(positions.subarray(21, 24));
    [13, 2, -2].forEach((value, axis) => near(corner[axis], value, 1e-5));
  });

  it('reads interleaved accessors from their byte spans only', () => {
    const square = box([1, 2, 3], [2, 4, 6]);
    const bytes = editGlb(
      meshesToGlb([{ name: 'part', ...square }], { scale: 1 }),
      (json) => {
        // POSITION and NORMAL share one view, 24 bytes per vertex.
        const [positions, normals] = json.accessors;
        normals.bufferView = positions.bufferView;
        normals.byteOffset = 12;
        positions.count = 4;
        normals.count = 4;
        json.bufferViews[positions.bufferView].byteStride = 24;
        json.meshes[0].primitives[0].indices = undefined;
        return json;
      }
    );
    const jsonLength = glbJsonLength(bytes);
    const json = JSON.parse(
      new globalThis.TextDecoder().decode(
        bytes.subarray(GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength)
      )
    );
    expect(meshAccessors(json)).toEqual([0]);
    const span = accessorSpan(json, 0);
    expect(span.end - span.start).toBe(3 * 24 + 12);
    const binary = glbBinaryOffset(jsonLength);
    const [mesh] = gltfMeshes(json, (index) => {
      const { start, end } = accessorSpan(json, index);
      return bytes.subarray(binary + start, binary + end);
    });
    // Every other vertex of the box: corners 0, 2, 4 and 6 (x low).
    expect(Array.from(mesh.positions)).toEqual(
      Array.from(
        [0, 2, 4, 6].flatMap((corner) => [
          ...square.positions.subarray(corner * 3, corner * 3 + 3),
        ])
      )
    );
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 3]);
  });

  it('rejects files that are not glTF 2.0 binaries', () => {
    expect(() => glbJsonLength(new Uint8Array(20))).toThrow();
  });
});

describe('teeth of one arch mesh', () => {
  /** Seven teeth a side along a U, each a box 6 mm wide and 20 mm tall. */
  function arch() {
    const teeth = [];
    for (const side of [1, -1]) {
      for (let type = 0; type < 7; type++) {
        const angle = (type + 0.5) * 0.22;
        teeth.push(
          box(
            [side * 25 * Math.sin(angle), 0, 25 * Math.cos(angle)],
            [5, 20, 6]
          )
        );
      }
    }
    return teeth;
  }

  it('splits a mesh into its pieces and joins split seams', () => {
    const teeth = arch();
    const merged = mergeMeshes(teeth);
    expect(connectedPieces(merged, { minVertices: 8 }).length).toBe(14);
    expect(connectedPieces(merged).length).toBe(0);
    // A box whose faces are all separate keeps together by position.
    const { positions, indices } = teeth[0];
    const loose = {
      positions: Float32Array.from(
        Array.from(indices).flatMap((index) => [
          ...positions.subarray(index * 3, index * 3 + 3),
        ])
      ),
      indices: Array.from(indices, (_, index) => index),
    };
    expect(connectedPieces(loose, { minVertices: 8 }).length).toBe(1);
  });

  it('numbers each side from the midline back', () => {
    const teeth = arch();
    const numbered = numberTeeth(
      connectedPieces(mergeMeshes(teeth), { minVertices: 8 }),
      'upper'
    );
    expect(numbered.length).toBe(14);
    for (const tooth of numbered) {
      const index = (tooth.side === 'l' ? 0 : 7) + tooth.type;
      expect(tooth.positions[0]).toBe(teeth[index].positions[0]);
      expect(tooth.jaw).toBe('upper');
    }
  });

  it('measures the sagittal lean of a long axis', () => {
    // A tall box sheared forward at the top by tan(20 degrees).
    const tall = box([0, 0, 0], [6, 20, 6]);
    const sheared = tall.positions.map((value, index) =>
      index % 3 === 2
        ? value + Math.tan(Math.PI / 9) * tall.positions[index - 1]
        : value
    );
    // Principal axis of its corners: half of atan2(2 * 100 tan, 100 -
    // 9 - 100 tan^2), about 21.6 degrees.
    const tan = Math.tan(Math.PI / 9);
    const expected =
      (0.5 * Math.atan2(200 * tan, 91 - 100 * tan * tan) * 180) / Math.PI;
    near(sagittalLean(sheared), expected, 1e-4);
    expect(
      sagittalLean(
        sheared.map((value, index) => (index % 3 === 1 ? -value : value))
      )
    ).toBeLessThan(-15);
    near(sagittalLean(tall.positions), 0, 1e-9);
  });
});

describe('mouth landmarks', () => {
  it('finds the key points on the midsagittal slab', () => {
    const mouth = boxMouth();
    expect(midlineOf(mouth.upperTeeth)).toBe(0);
    expect(slabPoints(mouth.palate, 0).length).toBeGreaterThan(0);
    expect(slabPoints(mouth.palate, 40).length).toBe(0);
    const landmarks = mouthLandmarks(mouth);
    expect(landmarks.upperIncisor.slice(1)).toEqual([0, 99]);
    expect(landmarks.lowerIncisor.slice(1)).toEqual([-1, 96.5]);
    expect(landmarks.palateFront[2]).toBe(95);
    expect(landmarks.staphylion[2]).toBe(55);
    expect(landmarks.tongueTip[2]).toBe(90);
    expect(landmarks.tongueDorsum[1]).toBe(5);
    expect(landmarks.uvula[1]).toBe(-4);
    const measures = mouthMeasures(landmarks);
    expect(measures.overjet).toBe(2.5);
    expect(measures.overbite).toBe(-1);
    expect(measures.dorsumHeight).toBe(5);
    expect(() =>
      mouthLandmarks({ ...mouth, velum: box([40, 8, 50], [4, 4, 4]) })
    ).toThrow();
  });

  it('fits one mouth onto a turned and moved copy exactly', () => {
    const landmarks = mouthLandmarks(boxMouth());
    const angle = 0.3;
    const moved = Object.fromEntries(
      Object.entries(landmarks).map(([name, [x, y, z]]) => [
        name,
        [
          x + 5,
          Math.cos(angle) * y - Math.sin(angle) * z + 700,
          Math.sin(angle) * y + Math.cos(angle) * z - 20,
        ],
      ])
    );
    const { rms, residuals } = compareLandmarks(landmarks, moved);
    expect(rms).toBeLessThan(1e-6);
    for (const residual of Object.values(residuals)) {
      expect(residual).toBeLessThan(1e-6);
    }
  });

  it('poses the model jaw to a reference incisor gap', () => {
    for (const gap of [1, 2, 6]) {
      const model = mouthLandmarks(
        modelMouthParts(presetHeadConfig('male'), { gap }),
        { midline: 0 }
      );
      near(-mouthMeasures(model).overbite, gap, 0.6);
    }
  });
});

describe('procedural mouth against the Human Reference Atlas', () => {
  for (const [preset, source] of [
    ['male', 'hra-male'],
    ['female', 'hra-female'],
  ]) {
    it(`lands the ${preset} mouth on the ${source} key points`, () => {
      const reference = FIXTURE.sources[source];
      const model = mouthLandmarks(
        modelMouthParts(presetHeadConfig(preset), {
          gap: -reference.measures.overbite,
        }),
        { midline: 0 }
      );
      const { rms, residuals } = compareLandmarks(
        model,
        reference.landmarks,
        FIT
      );
      // Within a few millimetres after a rigid fit; the atlas is one
      // cadaver, so its own mouth is about as far from the norms.
      expect(rms).toBeLessThan(preset === 'male' ? 6 : 8);
      expect(residuals.upperIncisor).toBeLessThan(5);
      expect(residuals.lowerIncisor).toBeLessThan(5);
      expect(residuals.staphylion).toBeLessThan(9);
      const measures = mouthMeasures(model);
      near(
        measures.incisorToStaphylion,
        reference.measures.incisorToStaphylion,
        8
      );
      // Upper incisors lean back at the root, lower ones forward at the
      // edge, about as much as the atlas's.
      expect(reference.incisorLean.upper).toBeLessThan(-15);
      expect(reference.incisorLean.lower).toBeGreaterThan(15);
    });
  }

  it('reads the fixture male from range requests of the atlas file', async () => {
    // A stand-in fetcher serving a tiny atlas file: only the named nodes'
    // accessors are asked for.
    const meshes = Object.entries(boxMouth()).map(([name, mesh]) => ({
      name,
      ...mesh,
    }));
    const prefix = 'VH_M_';
    const names = {
      upperTeeth: 'set_of_upper_jaw_teeth',
      lowerTeeth: 'set_of_lower_jaw_teeth',
      palate: 'hard_palate',
      velum: 'mucosa_of_soft_palate',
      tongue: 'dorsal_tongue',
    };
    const atlas = meshesToGlb(
      [
        ...meshes.map((mesh) => ({ ...mesh, name: prefix + names[mesh.name] })),
        { name: `${prefix}ventral_tongue`, ...box([0, -12, 70], [20, 4, 30]) },
        {
          name: `${prefix}posterior_part_of_tongue`,
          ...box([0, -10, 40], [20, 10, 10]),
        },
        { name: `${prefix}uvula`, ...box([0, 0, 0], [1, 1, 1]) },
      ],
      { scale: 0.001 }
    );
    const asked = [];
    const fetcher = async (url, start, end) => {
      asked.push(end - start);
      return Buffer.from(atlas.subarray(start, end));
    };
    const directory = mkdtempSync(join(tmpdir(), 'hra-stand-in-'));
    try {
      await fetchHraMouth({ url: 'stand-in', prefix }, directory, fetcher);
      const measured = measureMouth(directory);
      expect(measured.landmarks.upperIncisor.slice(1)).toEqual([0, 99]);
      expect(measured.measures.overjet).toBe(2.5);
      // Header, JSON and two accessors a mesh, but not the uvula's.
      expect(asked.length).toBe(2 + 2 * 7);
      expect(asked.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThan(
        atlas.length
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  itUnless(offline)(
    'measures the hra-male mouth as the fixture records',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'hra-male-'));
      try {
        await fetchAnatomy('hra-male', directory);
        const { landmarks, measures, incisorLean } = measureMouth(directory);
        const recorded = FIXTURE.sources['hra-male'];
        expect(landmarks).toEqual(recorded.landmarks);
        expect(measures).toEqual(recorded.measures);
        expect(incisorLean).toEqual(recorded.incisorLean);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
