/**
 * The model's midsagittal key points against the HuBMAP HRA Visible Human
 * mouth and larynx (tests/fixtures/anatomy/hra.json), and the tools that
 * find them: shells, tooth classification, MRI-like midline cuts and the
 * rigid comparison. The fixture is re-measured just in time from the HRA
 * CDN when the network allows.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import {
  KEY_POINTS,
  classifyTeeth,
  compareKeyPoints,
  incisorLean,
  keyPointMeasures,
  labialLean,
  meshShells,
  midsagittalPoints,
  mirrorX,
  modelIncisorLean,
  modelKeyPoints,
  sagittalLean,
} from '../src/geometry/reference-anatomy.js';
import { mergeMeshes } from '../src/geometry/loft.js';
import { presetHeadConfig } from '../src/head-config.js';
import { HRA } from '../scripts/fetch-anatomy.mjs';
import { measureHra } from '../scripts/build-hra-reference.mjs';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

// Before any test is registered, so CPU-bound tests do not stall the probe.
const offline = await networkSkipReason({ url: HRA.urls.male[1] });

const FIXTURE = JSON.parse(
  readFileSync(
    new globalThis.URL('./fixtures/anatomy/hra.json', import.meta.url)
  )
);

const DENTAL = [
  'upperIncisor',
  'lowerIncisor',
  'upperFirstMolar',
  'upperSecondMolar',
  'palateVault',
];

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
  const positions = faces.flatMap((face) => face.flatMap(corner));
  const indices = faces.flatMap((_, face) =>
    [0, 1, 2, 0, 2, 3].map((index) => face * 4 + index)
  );
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

/** Vertices of `mesh` with z sheared forward by tan(degrees) per unit y. */
function sheared(mesh, degrees) {
  const tan = Math.tan((degrees * Math.PI) / 180);
  return Float64Array.from(mesh.positions, (value, index) =>
    index % 3 === 2 ? value + tan * mesh.positions[index - 1] : value
  );
}

const models = Object.fromEntries(
  ['male', 'female'].map((sex) => [sex, modelKeyPoints(presetHeadConfig(sex))])
);

describe('reference anatomy tools', () => {
  it('splits a mesh into shells, welding split vertices', () => {
    const shells = meshShells(
      mergeMeshes([box([0, 0, 0], [2, 2, 2]), box([5, 0, 0], [1, 1, 1])])
    );
    expect(shells.length).toBe(2);
    expect(shells[0].indices.length).toBe(36);
  });

  it('sorts the crowns of an arch into sides and tooth types', () => {
    // Seven teeth a side on a parabola, body left at +x as in the HRA.
    const crowns = [-1, 1].flatMap((side) =>
      Array.from({ length: 7 }, (_, type) => {
        const x = side * (2 + 4 * type);
        return box([x, 0, 50 - 0.04 * x * x], [3, 3, 3]);
      })
    );
    const teeth = classifyTeeth(mirrorX(crowns), 'upper');
    expect(teeth.length).toBe(14);
    for (const tooth of teeth) {
      const x =
        tooth.positions.reduce((sum, v, i) => (i % 3 ? sum : sum + v), 0) / 24;
      expect(Math.round(Math.abs(x))).toBe(2 + 4 * tooth.type);
      expect(Math.sign(x)).toBe(tooth.side === 'l' ? -1 : 1);
    }
  });

  it('cuts meshes on the midsagittal plane', () => {
    const points = midsagittalPoints(box([0, 10, 0], [4, 2, 6]));
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => Math.abs(point[1] - 10) <= 1 + 1e-9)).toBe(
      true
    );
  });

  it('samples the cut finely enough for the key point bands', () => {
    // A 20 mm long slab cut into two long segments per side: the band
    // 0.75 mm around z = 3 must still find points on its floor.
    const points = midsagittalPoints(box([0, 0, 0], [4, 2, 20]));
    const band = points.filter((point) => Math.abs(point[2] - 3) <= 0.75);
    expect(band.some((point) => Math.abs(point[1] + 1) < 1e-9)).toBe(true);
    expect(band.some((point) => Math.abs(point[1] - 1) < 1e-9)).toBe(true);
  });

  it('reads the lean of a long axis from its vertices', () => {
    const tan = Math.tan((20 * Math.PI) / 180);
    // Corners of a 6 x 20 x 6 box: var(y) 100, var(z) 9 + 100 tan^2.
    const exact =
      (0.5 * Math.atan2(200 * tan, 100 - 9 - 100 * tan * tan) * 180) / Math.PI;
    const tooth = sheared(box([0, 0, 0], [6, 20, 6]), 20);
    expect(Math.abs(sagittalLean(tooth) - exact)).toBeLessThan(1e-9);
    const mirrored = tooth.map((value, index) =>
      index % 3 === 1 ? -value : value
    );
    expect(Math.abs(sagittalLean(mirrored) + exact)).toBeLessThan(1e-9);
    expect(sagittalLean(box([0, 0, 0], [6, 20, 6]).positions)).toBe(0);
  });

  it('reads the lean of a crown from its labial face', () => {
    // A crown 10 mm high above its edge at y = 0, every vertex in a band.
    const crown = box([0, 5, 0], [6, 10, 4]);
    crown.positions = Float64Array.from(
      Array.from({ length: 11 }, (_, rise) =>
        [-2, 2].flatMap((z) => [0, rise, z])
      ).flat()
    );
    for (const degrees of [-15, 0, 25]) {
      const upper = labialLean(sheared(crown, degrees), 'upper');
      expect(Math.abs(upper - degrees)).toBeLessThan(1e-9);
      const down = sheared(crown, degrees).map((value, index) =>
        index % 3 === 1 ? -value : value
      );
      expect(Math.abs(labialLean(down, 'lower') + degrees)).toBeLessThan(1e-9);
    }
  });

  it('averages the lean of the central incisors of each jaw', () => {
    const tooth = (jaw, type, degrees) => ({
      jaw,
      type,
      positions: sheared(box([0, 0, 0], [6, 20, 6]), degrees),
    });
    const lean = incisorLean([
      tooth('upper', 0, -20),
      tooth('upper', 0, -20),
      tooth('upper', 1, 30),
      tooth('lower', 0, 20),
    ]);
    expect(Math.abs(lean.upper + lean.lower)).toBeLessThan(1e-9);
    expect(lean.upper).toBeLessThan(-15);
  });

  it('measures the mouth between key points', () => {
    const points = {
      upperIncisor: [0, 0, 50],
      lowerIncisor: [0, -2, 47],
      upperFirstMolar: [0, 2, 20],
      palateVault: [0, 16, 20],
      staphylion: [0, 10, 2],
      uvula: [0, -20, -38],
      tongueDorsum: [0, 12, 15],
      glottis: [0, -90, -10],
    };
    const measures = keyPointMeasures(points);
    expect(measures.incisorToStaphylion).toBe(Math.hypot(10, 48));
    expect(measures.velumChord).toBe(50);
    expect(measures.overjet).toBe(3);
    expect(measures.overbite).toBe(-2);
    expect(measures.dorsumHeight).toBe(12);
    expect(measures.palateHeight).toBe(14);
    expect(measures.glottisDepth).toBe(100);
  });

  it('finds no distance between a set of key points and a moved copy', () => {
    const angle = 0.3;
    const moved = Object.fromEntries(
      Object.entries(models.male).map(([name, [x, y, z]]) => [
        name,
        [
          x + 5,
          y * Math.cos(angle) - z * Math.sin(angle) + 700,
          y * Math.sin(angle) + z * Math.cos(angle),
        ],
      ])
    );
    const { distances, rms } = compareKeyPoints(models.male, moved);
    expect(rms).toBeLessThan(1e-6);
    expect(Object.keys(distances)).toEqual(KEY_POINTS);
  });
});

describe('model against the HuBMAP Visible Human', () => {
  it('orders the model key points like a mouth', () => {
    for (const points of Object.values(models)) {
      expect(points.upperIncisor[2]).toBeGreaterThan(points.upperFirstMolar[2]);
      expect(points.upperFirstMolar[2]).toBeGreaterThan(points.staphylion[2]);
      expect(points.palateVault[1]).toBeGreaterThan(points.upperFirstMolar[1]);
      expect(points.uvula[1]).toBeLessThan(points.staphylion[1]);
      expect(points.glottis[1]).toBeLessThan(points.uvula[1] - 30);
    }
  });

  it('places the teeth and vault within the measured jaw', () => {
    // Dental landmarks only: rigid, bony and independent of posture.
    const limits = { male: 3.5, female: 5.5 };
    for (const sex of ['male', 'female']) {
      const { rms, distances } = compareKeyPoints(models[sex], FIXTURE[sex], {
        fit: DENTAL,
      });
      expect(rms).toBeLessThan(limits[sex]);
      for (const name of DENTAL) {
        expect(distances[name]).toBeLessThan(8);
      }
    }
  });

  it('keeps every key point near the reference after one rigid fit', () => {
    // The cadavers rest with the mouth closed and the tongue against the
    // palate; their larynx sits 14-18 mm further forward of the incisors
    // than in the MRI speakers the tract follows.
    const limits = { male: 8.5, female: 12.5 };
    for (const sex of ['male', 'female']) {
      const { rms, distances } = compareKeyPoints(models[sex], FIXTURE[sex]);
      expect(rms).toBeLessThan(limits[sex]);
      expect(Math.max(...Object.values(distances))).toBeLessThan(21);
    }
  });

  it('leans the incisor crowns as the reference crowns lean', () => {
    // The two bodies differ by 10 degrees on the upper incisors; the model
    // is within 6 of each.
    for (const preset of ['male', 'female', 'child']) {
      const lean = modelIncisorLean(presetHeadConfig(preset));
      for (const sex of ['male', 'female']) {
        for (const jaw of ['upper', 'lower']) {
          expect(
            Math.abs(lean[jaw] - FIXTURE.labialLean[sex][jaw])
          ).toBeLessThan(6);
        }
      }
    }
  });

  it('spans the palate as the reference does', () => {
    // The female cadaver is the larger body (about 1.1 times the male),
    // the model's female the smaller.
    const limits = {
      male: { incisorToStaphylion: 10, palateHeight: 3 },
      female: { incisorToStaphylion: 10, palateHeight: 6 },
    };
    for (const sex of ['male', 'female']) {
      const model = keyPointMeasures(models[sex]);
      const reference = keyPointMeasures(FIXTURE[sex]);
      for (const [name, limit] of Object.entries(limits[sex])) {
        expect(Math.abs(model[name] - reference[name])).toBeLessThan(limit);
      }
    }
  });

  itUnless(offline)('re-measures the male reference just in time', async () => {
    const fresh = await measureHra('male');
    for (const name of KEY_POINTS) {
      fresh[name].forEach((value, axis) =>
        expect(Math.abs(value - FIXTURE.male[name][axis])).toBeLessThan(0.05)
      );
    }
  });
});
