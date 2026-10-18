/**
 * Dentition measurements (src/geometry/dental.js) on synthetic teeth, and
 * the procedural teeth held to the arch measures of segmented anatomy
 * (tests/fixtures/anatomy/dentition.json, rebuilt by
 * scripts/build-dental-reference.mjs from the just-in-time downloads of
 * scripts/fetch-anatomy.mjs).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { dentalLandmarks } from '../src/geometry/anatomy.js';
import {
  TOOTH_TYPES,
  archMeasures,
  toothLandmarks,
} from '../src/geometry/dental.js';
import { DEFAULT_HEAD, presetHeadConfig } from '../src/head-config.js';
import { measureSource } from '../scripts/build-dental-reference.mjs';
import {
  OPEN_FULL_JAW,
  fetchAnatomy,
  objPositions,
  universalTooth,
} from '../scripts/fetch-anatomy.mjs';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

/** Smallest download of the Open-Full-Jaw scans (both arches segmented). */
const PATIENT = 14;

// Before any test is registered, so CPU-bound tests do not stall the probe.
const offline = await networkSkipReason({ url: OPEN_FULL_JAW.url(PATIENT) });

const FIXTURE = JSON.parse(
  readFileSync(
    new globalThis.URL('./fixtures/anatomy/dentition.json', import.meta.url)
  )
);
const POPULATION = FIXTURE.sources['open-full-jaw'].statistics;

/**
 * Vertices of an axis-aligned box, `size` = [x, y, z], centred at `centre`.
 */
function boxVertices(centre, size) {
  const positions = [];
  for (let corner = 0; corner < 8; corner++) {
    for (let axis = 0; axis < 3; axis++) {
      const sign = (corner >> axis) & 1 ? 0.5 : -0.5;
      positions.push(centre[axis] + sign * size[axis]);
    }
  }
  return positions;
}

/**
 * A straight-sided "arch": teeth in a row along x on each side of the
 * midline, 4 mm wide (x), 6 mm thick (z) and 8 mm tall (y), upper above
 * lower with their edges 2 mm apart, each tooth's long axis vertical.
 * Front is +z: the teeth step back 3 mm each from the incisors.
 */
function boxDentition() {
  const teeth = [];
  for (const jaw of ['upper', 'lower']) {
    const y = jaw === 'upper' ? 5 : -5;
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? 1 : -1;
      for (let type = 0; type < TOOTH_TYPES.length; type++) {
        const centre = [sign * (2 + 4 * type), y, -3 * type];
        teeth.push({
          jaw,
          side,
          type,
          positions: boxVertices(centre, [4, 8, 6]),
        });
      }
    }
  }
  return teeth;
}

const near = (actual, expected, tolerance) =>
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);

describe('dentition measurements', () => {
  it('finds occlusal points, crown widths and thicknesses of box teeth', () => {
    const landmarks = toothLandmarks(boxDentition());
    expect(landmarks.length).toBe(28);
    const molar = landmarks.find(
      (tooth) => tooth.jaw === 'upper' && tooth.side === 'l' && tooth.type === 6
    );
    // The upper teeth reach down to y = 1, the lower ones up to y = -1.
    near(molar.occlusal[1], 1, 1e-9);
    near(molar.occlusal[0], 26, 1e-9);
    near(molar.occlusal[2], -18, 1e-9);
    // Along this arch, which steps back 3 mm every 4 mm, the box is seen
    // obliquely: its extent along the tangent (4, 0, -3) / 5 and across it.
    near(molar.width, 4 * 0.8 + 6 * 0.6, 1e-6);
    near(molar.thickness, 6 * 0.8 + 4 * 0.6, 1e-6);
  });

  it('measures arch widths, depth, length, overjet and overbite', () => {
    const measures = archMeasures(toothLandmarks(boxDentition()));
    for (const jaw of ['upper', 'lower']) {
      near(measures[jaw].intercanine, 2 * 10, 1e-6);
      near(measures[jaw].intermolar, 2 * 22, 1e-6);
      // Incisors at z = 0, first molars at z = -15.
      near(measures[jaw].depth, 15, 1e-6);
      expect(measures[jaw].length).toBeGreaterThan(0);
    }
    near(measures.overjet, 0, 1e-6);
    // The edges are 2 mm apart: an open bite of 2 mm.
    near(measures.overbite, -2, 1e-6);
  });

  it('leaves out measures whose teeth are missing', () => {
    const teeth = boxDentition().filter(
      (tooth) => !(tooth.jaw === 'upper' && tooth.type === 5)
    );
    const measures = archMeasures(toothLandmarks(teeth));
    expect(measures.upper.intermolar).toBe(null);
    expect(measures.upper.depth).toBe(null);
    expect(measures.upper.length).toBe(null);
    expect(measures.upper.widths[5]).toBe(null);
    // The second molars still get a width from the premolars beside them
    // (the occlusal plane tilts a little with the gap in the arch).
    near(measures.upper.widths[6], 6.8, 0.1);
    // Forward comes from the lower arch.
    near(measures.lower.depth, 15, 0.1);
    near(measures.overjet, 0, 0.1);
  });

  it('finds the crowns of a single arch from their bulk', () => {
    // Crowns (y 1..9, 6 mm thick) on narrower roots (y 9..19, 3 mm).
    const teeth = boxDentition()
      .filter((tooth) => tooth.jaw === 'upper')
      .map((tooth) => {
        const crown = Array.from(tooth.positions);
        const root = boxVertices([crown[0] + 2, 14, crown[2] + 3], [2, 10, 3]);
        return { ...tooth, positions: [...crown, ...root] };
      });
    for (const tooth of toothLandmarks(teeth)) {
      near(tooth.occlusal[1], 1, 1e-9);
    }
    const flipped = teeth.map((tooth) => ({
      ...tooth,
      jaw: 'lower',
      positions: tooth.positions.map((value, index) =>
        index % 3 === 1 ? -value : value
      ),
    }));
    for (const tooth of toothLandmarks(flipped)) {
      near(tooth.occlusal[1], -1, 1e-9);
    }
  });

  it('numbers teeth the universal way and reads OBJ vertices', () => {
    expect(universalTooth(1)).toBe(null);
    expect(universalTooth(8)).toEqual({ jaw: 'upper', side: 'r', type: 0 });
    expect(universalTooth(9)).toEqual({ jaw: 'upper', side: 'l', type: 0 });
    expect(universalTooth(14)).toEqual({ jaw: 'upper', side: 'l', type: 5 });
    expect(universalTooth(16)).toBe(null);
    expect(universalTooth(18)).toEqual({ jaw: 'lower', side: 'l', type: 6 });
    expect(universalTooth(25)).toEqual({ jaw: 'lower', side: 'r', type: 0 });
    expect(universalTooth(32)).toBe(null);
    const positions = objPositions(
      '# comment\nv 1 2 3\nvn 0 0 1\nv  -4.5 5 6e1\nf 1 2 3\n'
    );
    expect(Array.from(positions)).toEqual([1, 2, 3, -4.5, 5, 60]);
  });
});

describe('procedural teeth against segmented anatomy', () => {
  const zScore = (value, { mean, sd }) => Math.abs(value - mean) / sd;

  it('lays the arches out like the Open-Full-Jaw population', () => {
    const model = archMeasures(dentalLandmarks(DEFAULT_HEAD));
    for (const jaw of ['upper', 'lower']) {
      for (const name of ['intercanine', 'intermolar', 'depth']) {
        expect(zScore(model[jaw][name], POPULATION[jaw][name])).toBeLessThan(
          1.5
        );
      }
      model[jaw].widths.forEach((width, type) => {
        expect(zScore(width, POPULATION[jaw].widths[type])).toBeLessThan(1);
      });
      expect(zScore(model[jaw].length, POPULATION[jaw].length)).toBeLessThan(1);
    }
  });

  it('keeps every head preset within two standard deviations', () => {
    for (const preset of ['male', 'female', 'child']) {
      const model = archMeasures(dentalLandmarks(presetHeadConfig(preset)));
      for (const jaw of ['upper', 'lower']) {
        for (const name of ['intercanine', 'intermolar', 'depth']) {
          expect(zScore(model[jaw][name], POPULATION[jaw][name])).toBeLessThan(
            2
          );
        }
      }
    }
  });

  it('puts the lower arch inside the upper one', () => {
    const model = archMeasures(dentalLandmarks(DEFAULT_HEAD));
    expect(model.upper.intercanine).toBeGreaterThan(model.lower.intercanine);
    expect(model.upper.depth).toBeGreaterThan(model.lower.depth);
    expect(model.overjet).toBeGreaterThan(0);
  });

  it('agrees with BodyParts3D and Z-Anatomy on the arch widths', () => {
    const model = archMeasures(dentalLandmarks(DEFAULT_HEAD));
    for (const source of ['bodyparts3d', 'z-anatomy']) {
      const { measures } = FIXTURE.sources[source];
      for (const jaw of ['upper', 'lower']) {
        for (const name of ['intercanine', 'intermolar']) {
          near(model[jaw][name], measures[jaw][name], 6);
        }
      }
    }
  });

  itUnless(offline)(
    `measures Open-Full-Jaw patient ${PATIENT} as the fixture records`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'open-full-jaw-'));
      try {
        await fetchAnatomy('open-full-jaw', directory, {
          patients: [PATIENT],
        });
        const measured = measureSource(
          'open-full-jaw',
          join(directory, `Patient_${PATIENT}`)
        );
        expect(measured).toEqual(
          FIXTURE.sources['open-full-jaw'].patients[PATIENT]
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
