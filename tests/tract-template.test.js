/**
 * The committed MRI tract template matches a fresh measurement of the
 * DVTD fixtures, so it cannot drift from the data it is built from.
 */

import { describe, it, expect } from 'test-anywhere';
import { tractTemplateData } from '../scripts/tract-template-data.mjs';
import { TRACT_TEMPLATE } from '../src/geometry/tract-template.js';

describe('tract template', () => {
  it('matches a fresh build from the DVTD fixtures', () => {
    const data = tractTemplateData();
    expect(TRACT_TEMPLATE.bendAngles).toEqual(data.bendAngles);
    expect(TRACT_TEMPLATE.aspects).toEqual(data.aspects);
    expect(TRACT_TEMPLATE.bendFractions).toEqual(data.bendFractions);
  });

  it('bends from the vertical pharynx to the forward mouth', () => {
    const angles = TRACT_TEMPLATE.bendAngles;
    expect(Math.abs(angles[0])).toBeLessThan(10);
    expect(angles[Math.floor(angles.length / 2)]).toBeGreaterThan(30);
    expect(angles.at(-1)).toBeGreaterThan(90);
  });
});
