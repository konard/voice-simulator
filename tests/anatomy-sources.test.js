/**
 * Anatomy switched part by part between the procedural model and segmented
 * sources: vertex clustering for the levels of detail, the similarity fit,
 * the registry and per-part selection, composition into a head (the lower
 * teeth riding on the jaw) and the head parameters a source reduces to.
 * The synthetic source is the procedural model itself, so composing it
 * back must give the procedural parts; the HuBMAP HRA female is composed
 * just in time when the network allows.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  ANATOMY_PARTS,
  PROCEDURAL,
  SOURCE_LOD_CELLS,
  anatomySelection,
  anatomySource,
  anatomySourceFromGlb,
  anatomySourceNames,
  anatomySourceParts,
  composeAnatomy,
  fitAnatomySource,
  registerAnatomySource,
  similarityFit,
  sourceHead,
  unregisterAnatomySource,
} from '../src/geometry/anatomy-sources.js';
import { anatomyMeshes, dentalLandmarks } from '../src/geometry/anatomy.js';
import { transformPoint } from '../src/geometry/align.js';
import { clusterVertices } from '../src/geometry/decimate.js';
import { meshesToGlb } from '../src/geometry/gltf.js';
import { headModel } from '../src/geometry/model.js';
import { modelKeyPoints } from '../src/geometry/reference-anatomy.js';
import { REST_GAP } from '../src/articulation/teeth.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { presetHeadConfig } from '../src/head-config.js';
import { HRA, fetchHra } from '../src/geometry/hra.js';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

// Before any test is registered, so CPU-bound tests do not stall the probe.
const offline = await networkSkipReason({ url: HRA.urls.female[1] });

const HEAD = presetHeadConfig('male');
const OPEN = { height: 0, backness: 0.3, rounding: 0 };
const ROLES = Object.fromEntries(
  ANATOMY_PARTS.map((part) => [part, (name) => name === part])
);

/** The procedural parts in millimetres, the jaw closed as in a scan. */
function scannedModel(head, scale = 1) {
  const rest = tractShape({}, head);
  const shape = { ...rest, teeth: { ...rest.teeth, gap: REST_GAP } };
  return anatomyMeshes(head, { lod: 3, shape }).map((part) => ({
    name: part.name,
    positions: Float64Array.from(part.positions, (value) => value * 10 * scale),
    indices: part.indices,
  }));
}

function selfSource(name = 'self', scale = 1) {
  const keyPoints = Object.fromEntries(
    Object.entries(modelKeyPoints(HEAD)).map(([key, point]) => [
      key,
      point.map((value) => value * scale),
    ])
  );
  return anatomySource(name, scannedModel(HEAD, scale), {
    roles: ROLES,
    keyPoints,
  });
}

function largestDifference(a, b) {
  let worst = 0;
  a.forEach((value, index) => {
    worst = Math.max(worst, Math.abs(value - b[index]));
  });
  return worst;
}

/** A grid of n×n squares in the z = 0 plane, two triangles each. */
function grid(n, size) {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= n; row++) {
    for (let column = 0; column <= n; column++) {
      positions.push((column * size) / n, (row * size) / n, 0);
    }
  }
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const corner = row * (n + 1) + column;
      indices.push(corner, corner + 1, corner + n + 2);
      indices.push(corner, corner + n + 2, corner + n + 1);
    }
  }
  return { positions, indices };
}

describe('clusterVertices', () => {
  it('copies the mesh for a cell of 0', () => {
    const mesh = grid(4, 1);
    const copy = clusterVertices(mesh, 0);
    expect(Array.from(copy.positions)).toEqual(mesh.positions);
    expect(Array.from(copy.indices)).toEqual(mesh.indices);
  });

  it('merges vertices per cube and drops collapsed triangles', () => {
    const mesh = grid(40, 0.999);
    const coarse = clusterVertices(mesh, 0.1);
    expect(coarse.positions.length / 3).toBe(100);
    expect(coarse.indices.length).toBeLessThan(mesh.indices.length / 4);
    expect(coarse.indices.length).toBeGreaterThan(0);
    for (let index = 0; index < coarse.indices.length; index += 3) {
      const [a, b, c] = coarse.indices.slice(index, index + 3);
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
    // Every merged vertex stays inside its cube.
    for (const value of coarse.positions) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('similarityFit', () => {
  it('recovers a rotation, a translation and a scale', () => {
    const turn = Math.PI / 7;
    const truth = {
      rotation: [
        [Math.cos(turn), -Math.sin(turn), 0],
        [Math.sin(turn), Math.cos(turn), 0],
        [0, 0, 1],
      ],
      translation: [3, -2, 5],
      scale: 0.8,
    };
    const points = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 7, 0],
      [0, 0, 4],
      [3, 5, 9],
    ];
    const moved = points.map((point) => transformPoint(point, truth));
    const fit = similarityFit(points, moved);
    expect(Math.abs(fit.scale - 0.8)).toBeLessThan(1e-9);
    points.forEach((point, index) => {
      transformPoint(point, fit).forEach((value, axis) =>
        expect(Math.abs(value - moved[index][axis])).toBeLessThan(1e-9)
      );
    });
  });
});

describe('anatomy source registry', () => {
  it('rejects the procedural name and meshes that match no part', () => {
    expect(() => anatomySource(PROCEDURAL, scannedModel(HEAD))).toThrow();
    expect(() =>
      anatomySource('none', [{ name: 'x', positions: [], indices: [] }])
    ).toThrow();
  });

  it('lists registered sources and the parts they provide', () => {
    const source = registerAnatomySource(selfSource('listed'));
    try {
      expect(anatomySourceNames()[0]).toBe(PROCEDURAL);
      expect(anatomySourceNames()).toContain('listed');
      expect(anatomySourceParts().listed).toEqual([...ANATOMY_PARTS]);
      expect(anatomySelection('listed').tongue).toBe(source);
    } finally {
      unregisterAnatomySource('listed');
    }
    expect(anatomySourceNames()).toEqual([PROCEDURAL]);
    expect(() => anatomySelection('listed')).toThrow();
  });

  it('reads a source from a glTF binary in metres', () => {
    const scanned = scannedModel(HEAD);
    // Mirrored in the file (the body's left at +x), as atlases often are.
    const mirrored = scanned.map((mesh) => ({
      ...mesh,
      positions: mesh.positions.map((value, index) =>
        index % 3 === 0 ? -value : value
      ),
    }));
    const bytes = meshesToGlb(mirrored, { scale: 0.001 });
    const source = anatomySourceFromGlb('file', bytes, {
      roles: ROLES,
      keyPoints: modelKeyPoints(HEAD),
      mirror: true,
    });
    expect(Object.keys(source.parts)).toEqual([...ANATOMY_PARTS]);
    expect(
      largestDifference(source.parts.palate.positions, scanned[3].positions)
    ).toBeLessThan(1e-3);
  });

  it('selects a source per part and validates part names', () => {
    const source = selfSource();
    const selection = anatomySelection({
      tongue: source,
      palate: PROCEDURAL,
    });
    expect(Object.keys(selection)).toEqual(['tongue']);
    expect(Object.keys(anatomySelection(source))).toEqual([...ANATOMY_PARTS]);
    expect(anatomySelection()).toEqual({});
    expect(() => anatomySelection({ lips: source })).toThrow();
  });
});

describe('composeAnatomy', () => {
  it('gives the procedural parts back from the model as a source', () => {
    const source = selfSource();
    const composed = composeAnatomy(HEAD, { anatomy: source, lod: 3 });
    const procedural = anatomyMeshes(HEAD, { lod: 3 });
    composed.forEach((part, index) => {
      expect(part.name).toBe(procedural[index].name);
      expect(part.source).toBe('self');
      expect(
        largestDifference(part.positions, procedural[index].positions)
      ).toBeLessThan(1e-4);
    });
  });

  it('carries the source lower teeth on the opening jaw', () => {
    const composed = composeAnatomy(HEAD, {
      anatomy: { lowerTeeth: selfSource() },
      state: OPEN,
      lod: 3,
    });
    const procedural = anatomyMeshes(HEAD, { lod: 3, state: OPEN });
    const lower = composed.find((part) => part.name === 'lowerTeeth');
    const closed = anatomyMeshes(HEAD, { lod: 3 }).find(
      (part) => part.name === 'lowerTeeth'
    );
    expect(lower.source).toBe('self');
    expect(
      largestDifference(lower.positions, procedural[1].positions)
    ).toBeLessThan(1e-4);
    // It did move: the open jaw is not the rest posture.
    expect(
      largestDifference(lower.positions, closed.positions)
    ).toBeGreaterThan(0.2);
    for (const part of composed.filter((item) => item !== lower)) {
      expect(part.source).toBe(PROCEDURAL);
    }
  });

  it('reduces source parts at every level of detail', () => {
    const source = selfSource();
    const counts = SOURCE_LOD_CELLS.map(
      (_, lod) =>
        composeAnatomy(HEAD, { anatomy: { tongue: source }, lod }).find(
          (part) => part.name === 'tongue'
        ).positions.length
    );
    for (let lod = 1; lod < counts.length; lod++) {
      expect(counts[lod]).toBeGreaterThan(counts[lod - 1]);
    }
    expect(counts.at(-1)).toBe(source.parts.tongue.positions.length);
  });

  it('scales a source to the head on request', () => {
    const small = selfSource('small', 0.8);
    expect(fitAnatomySource(small, HEAD).scale).toBe(0.1);
    const fitted = fitAnatomySource(small, HEAD, { scale: true });
    expect(Math.abs(fitted.scale - 0.125)).toBeLessThan(1e-6);
    const composed = composeAnatomy(HEAD, {
      anatomy: small,
      scale: true,
      lod: 3,
    });
    const procedural = anatomyMeshes(HEAD, { lod: 3 });
    expect(
      largestDifference(composed[0].positions, procedural[0].positions)
    ).toBeLessThan(1e-4);
  });

  it('goes through headModel with the anatomy option', () => {
    const plain = headModel(HEAD, { lod: 1 });
    const mixed = headModel(HEAD, {
      lod: 1,
      anatomy: { tongue: selfSource() },
    });
    expect(mixed.map((part) => part.name)).toEqual(
      plain.map((part) => part.name)
    );
    expect(mixed.find((part) => part.name === 'tongue').source).toBe('self');
    expect(plain.find((part) => part.name === 'tongue').source).toBeUndefined();
  });
});

describe('sourceHead', () => {
  it('finds the mouth width that gives the source arch width', () => {
    const molars = (head) =>
      dentalLandmarks(head).filter(
        (tooth) => tooth.jaw === 'upper' && tooth.type === 5
      );
    const [left, right] = molars({ ...HEAD, mouthWidth: 0.9 });
    const archWidth = Math.abs(left.occlusal[0] - right.occlusal[0]);
    const head = sourceHead(HEAD, { ...selfSource(), archWidth });
    expect(Math.abs(head.mouthWidth - 0.9)).toBeLessThan(0.005);
    expect(head.vocalTractLength).toBe(HEAD.vocalTractLength);
    // Without an arch width the head stays as it is.
    expect(sourceHead(HEAD, selfSource()).mouthWidth).toBe(HEAD.mouthWidth);
  });
});

describe('HRA female as a source', () => {
  itUnless(offline)('composes into the head just in time', async () => {
    const source = anatomySource('hra-female', await fetchHra('female'), {
      citation: HRA.citation,
      license: HRA.license,
    });
    expect(Object.keys(source.parts)).toEqual([...ANATOMY_PARTS]);
    expect(source.archWidth).toBeGreaterThan(40);
    expect(source.archWidth).toBeLessThan(65);
    const head = presetHeadConfig('female');
    const transform = fitAnatomySource(source, head);
    const model = modelKeyPoints(head);
    const incisor = transformPoint(source.keyPoints.upperIncisor, transform);
    expect(
      Math.hypot(
        ...incisor.map((value, axis) => value * 10 - model.upperIncisor[axis])
      )
    ).toBeLessThan(10);
    const composed = composeAnatomy(head, { anatomy: source, lod: 1 });
    expect(composed.every((part) => part.source === 'hra-female')).toBe(true);
    const width = sourceHead(head, source).mouthWidth;
    expect(width).toBeGreaterThan(0.7);
    expect(width).toBeLessThan(1.4);
  });
});
