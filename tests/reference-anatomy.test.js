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
  meshShells,
  midsagittalPoints,
  mirrorX,
  modelKeyPoints,
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

  itUnless(offline)('re-measures the male reference just in time', async () => {
    const fresh = await measureHra('male');
    for (const name of KEY_POINTS) {
      fresh[name].forEach((value, axis) =>
        expect(Math.abs(value - FIXTURE.male[name][axis])).toBeLessThan(0.05)
      );
    }
  });
});
