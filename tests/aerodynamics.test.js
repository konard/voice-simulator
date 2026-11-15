/**
 * Air flow, mouth pressure and turbulence source strength (issue 35).
 */

import { describe, it, expect } from 'test-anywhere';
import {
  Aerodynamics,
  ASPIRATION_REFERENCE,
  FRICATION_REFERENCE,
  ORAL_COMPLIANCE,
  RE_CRITICAL,
  VISCOSITY,
  glottalArea,
  openTractStrength,
  reynolds,
  sourceStrength,
} from '../src/acoustics/aerodynamics.js';

const DT = 1e-5;

/** Run constant inputs for `duration` seconds, return the last result. */
function settle(lungPressure, glottis, constriction, duration = 0.2) {
  const air = new Aerodynamics();
  let result;
  for (let time = 0; time < duration; time += DT) {
    result = air.step(DT, lungPressure, glottis, constriction);
  }
  return result;
}

const decibels = (ratio) => 20 * Math.log10(ratio);
const near = (value, expected, tolerance) =>
  expect(Math.abs(value - expected)).toBeLessThan(tolerance);

describe('aerodynamics', () => {
  it('splits the lung pressure', () => {
    const result = settle(8000, 0.2, 0.1);
    near(result.flow, 335, 2);
    near(result.constrictionDrop, 6400, 20);
    expect(
      Math.abs(result.glottalDrop + result.constrictionDrop - 8000)
    ).toBeLessThan(1e-6);
  });

  it('needs a critical Reynolds number', () => {
    const number = reynolds(335, 0.1);
    expect(number).toBeGreaterThan(7900);
    expect(number).toBeLessThan(8050);
    expect(sourceStrength(8000, 1, 20)).toBe(0);
    expect(reynolds(20, 1) < RE_CRITICAL).toBe(true);
    expect(VISCOSITY).toBe(0.15);
  });

  it('follows the power 1.5', () => {
    const strength = (lungPressure) => {
      const result = settle(lungPressure, 0.2, 0.1);
      return sourceStrength(result.constrictionDrop, 0.1, result.flow);
    };
    const rise = decibels(strength(16000) / strength(8000));
    expect(Math.abs(rise - 9)).toBeLessThan(0.5);
  });

  it('builds up pressure behind a closure', () => {
    const riseTime = (glottis) => {
      const air = new Aerodynamics();
      let time = 0;
      while (air.step(DT, 8000, glottis, 0).oralPressure < 0.632 * 8000) {
        time += DT;
      }
      return time * 1000;
    };
    const open = riseTime(0.2);
    expect(open).toBeGreaterThan(8);
    expect(open).toBeLessThan(14);
    const voiced = riseTime(0.05);
    expect(voiced).toBeGreaterThan(30);
    expect(voiced).toBeLessThan(55);
    expect(ORAL_COMPLIANCE).toBe(1e-3);
  });

  it('keeps the mouth pressure when both orifices are closed', () => {
    const air = new Aerodynamics();
    for (let step = 0; step < 2000; step++) {
      air.step(DT, 8000, 0.2, 0);
    }
    const held = air.oralPressure;
    const result = air.step(DT, 8000, 0, 0);
    expect(result.oralPressure).toBe(held);
    expect(result.flow).toBe(0);
  });

  it('releases a stop in three phases', () => {
    const air = new Aerodynamics();
    const glottis = 0.25;
    const times = [];
    const derivative = [];
    const constriction = [];
    const aspiration = [];
    for (let step = 0; step < 0.25 / DT; step++) {
      const time = step * DT;
      const opening = Math.min(1, Math.max(0, (time - 0.1) / 0.02));
      const result = air.step(DT, 8000, glottis, opening);
      if (time < 0.1) {
        continue;
      }
      times.push(time - 0.1);
      derivative.push(result.flowDerivative);
      constriction.push(
        sourceStrength(result.constrictionDrop, opening, result.flow)
      );
      aspiration.push(sourceStrength(result.glottalDrop, glottis, result.flow));
    }
    const peakOf = (values) =>
      values.reduce(
        (best, value, index) => (value > values[best] ? index : best),
        0
      );
    expect(times[peakOf(derivative)]).toBeLessThan(0.003);
    const constrictionPeak = peakOf(constriction);
    expect(times[constrictionPeak]).toBeLessThan(times[peakOf(aspiration)]);
    const at = (time) => times.findIndex((value) => value >= time);
    expect(constriction[at(0.03)]).toBeLessThan(
      0.1 * constriction[constrictionPeak]
    );
    expect(aspiration[at(0.04)]).toBeGreaterThan(0.9 * aspiration.at(-1));
  });

  it('normalises the strengths to the reference states', () => {
    // A default voiceless fricative: P_L 8000, A_g 0.25, A_c 0.09.
    const fricative = settle(8000, 0.25, 0.09);
    near(
      sourceStrength(fricative.constrictionDrop, 0.09, fricative.flow) /
        FRICATION_REFERENCE,
      1,
      1e-6
    );
    near(openTractStrength(8000, 0.25), 1, 1e-9);
    expect(ASPIRATION_REFERENCE > FRICATION_REFERENCE).toBe(true);
  });

  it('opens the glottis with voicing, aspiration and breathiness', () => {
    const vowel = { voicing: 1, aspiration: 0, closure: 0 };
    near(glottalArea(vowel, 0.2), 0.07, 1e-12);
    near(glottalArea(vowel, 1), 0.15, 1e-12);
    near(
      glottalArea({ voicing: 0, aspiration: 1, closure: 0 }, 0.2),
      0.25,
      1e-12
    );
    expect(
      glottalArea({ voicing: 1, aspiration: 1, closure: 1 }, 0.2, 10)
    ).toBe(0.1);
  });
});
