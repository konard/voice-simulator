/**
 * The procedural hard palate and velum (src/geometry/anatomy.js) held to
 * published measurements of skulls, CT and MRI and to the Z-Anatomy maxilla
 * (tests/fixtures/anatomy/palate.json).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import { ANATOMY_LODS } from '../src/geometry/anatomy.js';
import { palateMeasures } from '../src/geometry/palate-measures.js';
import { presetHeadConfig } from '../src/head-config.js';

const { sources } = JSON.parse(
  readFileSync(
    new globalThis.URL('./fixtures/anatomy/palate.json', import.meta.url),
    'utf8'
  )
);
const measures = Object.fromEntries(
  ['male', 'female', 'child'].map((name) => [
    name,
    palateMeasures(presetHeadConfig(name)),
  ])
);
/** Allowed distance from a published mean, in standard deviations. */
const SPREAD = 1.5;

function withinNorm(value, { mean, sd }) {
  expect(Math.abs(value - mean)).toBeLessThan(SPREAD * sd);
}

describe('hard palate', () => {
  it('is as long as the skulls of men and women', () => {
    const norm = sources.tomaszewska2014.measures.oraleStaphylion;
    withinNorm(measures.male.oraleStaphylion, norm.male);
    withinNorm(measures.female.oraleStaphylion, norm.female);
    expect(measures.child.oraleStaphylion).toBeLessThan(
      measures.female.oraleStaphylion
    );
  });

  it('ends at the posterior nasal spine behind the second molars', () => {
    for (const name of ['male', 'female']) {
      expect(measures[name].nasalSpineBehindMolars).toBeGreaterThan(5);
      expect(measures[name].nasalSpineBehindMolars).toBeLessThan(15);
    }
    // The second molars of a child have not erupted far back yet.
    expect(measures.child.nasalSpineBehindMolars).toBeGreaterThan(-2);
  });

  it('vaults above the molars, highest towards the front', () => {
    const anatomy = sources['z-anatomy'].measures;
    for (const name of ['male', 'female']) {
      const { vaultHeightFirstMolars, vaultHeightSecondMolars } =
        measures[name];
      expect(vaultHeightFirstMolars).toBeGreaterThan(10);
      expect(vaultHeightFirstMolars).toBeLessThan(
        anatomy.vaultHeightFirstMolars + 3
      );
      expect(vaultHeightSecondMolars).toBeLessThan(vaultHeightFirstMolars);
    }
    expect(measures.male.vaultHeightSecondMolars).toBeGreaterThan(
      anatomy.vaultHeightSecondMolars - 3
    );
  });
});

describe('velum', () => {
  it('has the length and thickness of adult velums at rest', () => {
    const { velarLength, velarThickness } = sources.perry2014.measures;
    for (const name of ['male', 'female']) {
      withinNorm(measures[name].velarLength, velarLength.adult);
      withinNorm(measures[name].velarThickness, velarThickness.adult);
    }
  });

  it('is shorter and thinner in a child, near the children measured', () => {
    const { velarLength, velarThickness } = sources.kollara2016.measures;
    const near = (value, { low, high }) => {
      expect(value).toBeGreaterThan(low - 3);
      expect(value).toBeLessThan(high + 3);
    };
    near(measures.child.velarLength, velarLength.child);
    near(measures.child.velarThickness, velarThickness.child);
    expect(measures.child.velarLength).toBeLessThan(measures.male.velarLength);
  });

  it('keeps its size at every level of detail', () => {
    const head = presetHeadConfig('male');
    for (let lod = 1; lod < ANATOMY_LODS.length; lod++) {
      const { velarLength, oraleStaphylion } = palateMeasures(head, { lod });
      expect(Math.abs(velarLength - measures.male.velarLength)).toBeLessThan(2);
      expect(
        Math.abs(oraleStaphylion - measures.male.oraleStaphylion)
      ).toBeLessThan(2);
    }
  });
});
