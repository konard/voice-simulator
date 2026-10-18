/**
 * The procedural hard palate and velum (src/geometry/anatomy.js) held to
 * the anatomical norms and the Z-Anatomy skull measures in
 * tests/fixtures/anatomy/palate.json.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import { presetHeadConfig } from '../src/head-config.js';
import { palateMeasures } from './helpers/palate-measures.js';

const reference = JSON.parse(
  readFileSync(
    new globalThis.URL('./fixtures/anatomy/palate.json', import.meta.url)
  )
);
const { norms, zAnatomy } = reference;

/** Allowed distance from a norm's mean, in standard deviations. */
const SDS = 1.5;
/** Allowed relative distance from a mean given without a deviation. */
const RELATIVE = 0.15;
/** Oral mucosa under the bony vault (mm), from the fixture's note. */
const MUCOSA = 3;

const measures = Object.fromEntries(
  ['male', 'female', 'child'].map((preset) => [
    preset,
    palateMeasures(presetHeadConfig(preset)),
  ])
);

const withinSds = (value, { mean, sd }) => Math.abs(value - mean) <= SDS * sd;

describe('palate and velum against anatomy', () => {
  it('has the orale-staphylion length of men and women', () => {
    for (const sex of ['male', 'female']) {
      const length = measures[sex].oraleStaphylion;
      expect(withinSds(length, norms.oraleStaphylion[sex])).toBe(true);
    }
    expect(measures.male.oraleStaphylion).toBeGreaterThan(
      measures.female.oraleStaphylion
    );
  });

  it('ends the hard palate behind the second molars like the skull', () => {
    for (const sex of ['male', 'female']) {
      const behind = measures[sex].nasalSpineBehindMolars;
      expect(behind).toBeGreaterThan(5);
      expect(behind).toBeLessThan(15);
      expect(
        Math.abs(behind - zAnatomy.nasalSpineBehindSecondMolars)
      ).toBeLessThan(4);
    }
  });

  it('vaults the palate like the skull under its mucosa', () => {
    const height = measures.male.vaultHeightFirstMolars;
    const soft = zAnatomy.vaultHeightAboveFirstMolars - MUCOSA;
    expect(Math.abs(height - soft)).toBeLessThan(2);
    for (const preset of ['male', 'female', 'child']) {
      const { vaultHeightFirstMolars, vaultHeightSecondMolars } =
        measures[preset];
      expect(vaultHeightFirstMolars).toBeGreaterThan(vaultHeightSecondMolars);
    }
  });

  it('gives adults the velar length and thickness of MRI', () => {
    for (const sex of ['male', 'female']) {
      const { velumLength, velumThickness } = measures[sex];
      expect(withinSds(velumLength, norms.velumLength.adult)).toBe(true);
      expect(withinSds(velumThickness, norms.velumThickness.adult)).toBe(true);
    }
  });

  it('gives the child the velum of children', () => {
    const { velumLength, velumThickness } = measures.child;
    const lengthError =
      Math.abs(velumLength - norms.velumLength.child.mean) /
      norms.velumLength.child.mean;
    const thicknessError =
      Math.abs(velumThickness - norms.velumThickness.child.mean) /
      norms.velumThickness.child.mean;
    expect(lengthError).toBeLessThan(RELATIVE);
    expect(thicknessError).toBeLessThan(RELATIVE);
    expect(velumLength).toBeLessThan(measures.male.velumLength);
  });
});
