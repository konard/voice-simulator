/**
 * Tone model with pitch targets (issue 49): quantitative target
 * approximation, tone intervals and the neutral tone.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  NEUTRAL_LEVELS,
  TONE_RATES,
  approachTargets,
  neutralLevel,
  toneCurve,
  toneIntervals,
} from '../src/articulation/tone-model.js';

const FRAME_RATE = 200;

describe('tone model', () => {
  it('approaches a static target', () => {
    const { values } = approachTargets(
      [{ duration: 0.3, from: 0, to: 0, rate: 40 }],
      { value: 5, velocity: 0, acceleration: 0 },
      FRAME_RATE
    );
    expect(values.length).toBe(60);
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeLessThanOrEqual(values[index - 1]);
    }
    const middle = values[Math.round(0.075 * FRAME_RATE)];
    expect(middle).toBeGreaterThan(1.9);
    expect(middle).toBeLessThan(2.3);
    expect(values.at(-1)).toBeLessThan(0.01);
  });

  it('lags a ramp by 3 / rate', () => {
    const { values } = approachTargets(
      [{ duration: 1, from: 0, to: 10, rate: 50 }],
      null,
      FRAME_RATE
    );
    // 10 st/s × (0.5 s − 3 / 50 s) = 4.4 st.
    const value = values[Math.round(0.5 * FRAME_RATE)];
    expect(value).toBeGreaterThan(4.35);
    expect(value).toBeLessThan(4.45);
  });

  it('is continuous across intervals', () => {
    const scaled = (interval) => ({
      ...interval,
      from: interval.from * 2.3,
      to: interval.to * 2.3,
    });
    const intervals = [
      ...toneIntervals([5, 1], 0.2),
      ...toneIntervals([5], 0.2),
    ].map(scaled);
    const { values, state } = approachTargets(intervals, null, FRAME_RATE);
    expect(values.length).toBe(80);
    for (let index = 1; index < values.length; index++) {
      expect(Math.abs(values[index] - values[index - 1])).toBeLessThan(0.6);
    }
    expect(Math.abs(state.value - values.at(-1))).toBeLessThan(0.6);
  });

  it('carries the state into the next call', () => {
    const intervals = toneIntervals([5, 1], 0.2);
    const whole = approachTargets(
      [...intervals, ...toneIntervals([3], 0.2)],
      null,
      FRAME_RATE
    );
    const first = approachTargets(intervals, null, FRAME_RATE);
    const second = approachTargets(
      toneIntervals([3], 0.2),
      first.state,
      FRAME_RATE
    );
    const joined = [...first.values, ...second.values];
    expect(joined.length).toBe(whole.values.length);
    joined.forEach((value, index) =>
      expect(Math.abs(value - whole.values[index])).toBeLessThan(1e-9)
    );
  });

  it('splits tones into intervals', () => {
    const [level, ...rest] = toneIntervals([5], 0.2);
    expect(rest.length).toBe(0);
    expect(level).toEqual({
      duration: 0.2,
      from: 5,
      to: 5,
      rate: TONE_RATES.level,
    });
    const dip = toneIntervals([2, 1, 4], 0.2);
    expect(dip.length).toBe(2);
    expect(Math.abs(dip[0].duration - 0.08)).toBeLessThan(1e-12);
    expect(Math.abs(dip[1].duration - 0.12)).toBeLessThan(1e-12);
    expect(dip[0].rate).toBe(TONE_RATES.fall);
    expect(dip[1].rate).toBe(TONE_RATES.rise);
    expect(toneIntervals([1], 0.2)[0].rate).toBe(TONE_RATES.low);
  });

  it('picks the neutral level', () => {
    expect(neutralLevel([5])).toBe(2);
    expect(neutralLevel([3, 5])).toBe(3);
    expect(neutralLevel([2, 1])).toBe(4);
    expect(neutralLevel([2, 1, 4])).toBe(4);
    expect(neutralLevel([5, 1])).toBe(1);
    expect(neutralLevel(undefined)).toBe(2);
    expect(NEUTRAL_LEVELS.none).toBe(2);
  });

  it('draws the curve of one syllable', () => {
    const fall = toneCurve([5, 1], { count: 11 });
    expect(fall.length).toBe(11);
    expect(fall[0]).toBe(4);
    expect(fall.at(-1)).toBeLessThan(fall[0] - 4);
    // A neutral syllable after the fourth tone heads for level 1 (−4 st).
    const neutral = toneCurve([], { previous: [5, 1], start: 0 });
    expect(neutral[0]).toBe(0);
    expect(neutral.at(-1)).toBeLessThan(-2);
  });
});
