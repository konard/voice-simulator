/**
 * Tone model with pitch targets: the quantitative target approximation
 * model of Prom-on, Xu and Thipakorn (2009).
 *
 * Every tone is a pitch target, a line `x(t) = m·t + b` in semitones over
 * its interval (`t` in seconds from the interval start). The voice
 * approaches the target as a critically damped third-order system with
 * the rate `λ`, `y''' + 3λ·y'' + 3λ²·y' + λ³·(y − x) = 0`:
 *
 *     y(t)   = x(t) − 3m/λ + P(t)·e^(−λt),   P(t) = c1 + c2·t + c3·t²
 *     c1     = y(0) − b + 3m/λ
 *     c2     = y'(0) + c1·λ − m
 *     c3     = (y''(0) + 2·c2·λ − c1·λ²) / 2
 *     y'(t)  = m + (c2 + 2·c3·t − λ·P(t))·e^(−λt)
 *     y''(t) = (2·c3 − 2·λ·(c2 + 2·c3·t) + λ²·P(t))·e^(−λt)
 *
 * The term `−3m/λ` is the lag of the system behind a moving target: it
 * follows a ramp `3/λ` seconds late (60 ms at λ = 50), so a contour tone
 * does not reach its last level at the end of its syllable, and the pitch
 * changes smoothly where one interval meets the next. For a level target
 * (`m = 0`) there is no lag.
 *
 * `y`, `y'` and `y''` at the end of an interval are the start values of the
 * next one, so a tone starts where the tone before it ended (Xu 1997: the
 * preceding tone moves the start of a Mandarin syllable by up to 55 Hz, its
 * middle by 17 Hz and its end by 4 to 7 Hz). The slopes and heights of the
 * targets are not copied from the paper: they come from the Chao tone
 * letters, so any tone written with them (Mandarin, Cantonese, Thai,
 * Vietnamese) works.
 */

import { pointPositions } from './prosody.js';

/**
 * Rate `λ` of the approach per second for each kind of target. Prom-on,
 * Xu and Thipakorn (2009) report 34 to 55 for the four Mandarin tones;
 * `neutral` is a weak, slow approach. `level` is slower than the paper's
 * values: the interval of a syllable starts at the end of the vowel before
 * it and so takes in its onset consonant, and a faster level target would
 * be reached before the vowel starts. With 25, `ma˥` after `ma˥˩` is 2.8 st
 * below `ma˥` after `ma˥` at 10 % of the vowel (Xu 1997 measures up to
 * 55 Hz at the start) and 0.01 st at 95 %; with 50 it would be 0.2 st.
 */
export const TONE_RATES = Object.freeze({
  level: 25,
  rise: 40,
  fall: 40,
  low: 35,
  neutral: 25,
});

/**
 * Chao level of the neutral tone by the kind of tone before it (Chao 1930;
 * the textbook values 2, 3, 4, 1 after the Mandarin tones 1 to 4). `none`:
 * no tone before it in the phrase, or a neutral one.
 */
export const NEUTRAL_LEVELS = Object.freeze({
  high: 2,
  rise: 3,
  low: 4,
  fall: 1,
  none: 2,
});

/**
 * Kind of the tone before a neutral syllable: `low` when its highest level
 * is 2 or less or it has three levels (the third tone `˨˩˦` and its half
 * form `˨˩`), else `fall` when its first level is above its last, `rise`
 * when it is below, `high` otherwise and `none` without a tone. `low` is
 * tested first, so the half third tone `˨˩` (which also falls) gives the
 * level of the third tone.
 * @param {number[]|null|undefined} previousTone
 * @returns {keyof typeof NEUTRAL_LEVELS}
 */
export function neutralKind(previousTone) {
  if (!previousTone?.length) {
    return 'none';
  }
  const first = previousTone[0];
  const last = previousTone.at(-1);
  if (Math.max(...previousTone) <= 2 || previousTone.length === 3) {
    return 'low';
  }
  if (first > last) {
    return 'fall';
  }
  return first < last ? 'rise' : 'high';
}

/**
 * Chao level of a neutral syllable after `previousTone`.
 * @param {number[]|null|undefined} previousTone
 * @returns {number}
 */
export function neutralLevel(previousTone) {
  return NEUTRAL_LEVELS[neutralKind(previousTone)];
}

/** Rate of a target that moves from `from` to `to` (Chao levels). */
function targetRate(from, to) {
  if (to > from) {
    return TONE_RATES.rise;
  }
  if (to < from) {
    return TONE_RATES.fall;
  }
  return from <= 2 ? TONE_RATES.low : TONE_RATES.level;
}

/**
 * Pitch targets of one tone in Chao level units. One level gives one level
 * target over the whole `duration`; `n` levels give `n − 1` targets
 * between the positions of `pointPositions(n)` (`TONE_POINT_POSITIONS`:
 * 40 % and 60 % of the duration for three levels).
 * @param {number[]} tone Chao levels (1 lowest, 5 highest).
 * @param {number} duration Seconds.
 * @returns {{duration: number, from: number, to: number, rate: number}[]}
 */
export function toneIntervals(tone, duration) {
  if (tone.length === 1) {
    const [level] = tone;
    return [
      { duration, from: level, to: level, rate: targetRate(level, level) },
    ];
  }
  const positions = pointPositions(tone.length);
  const intervals = [];
  for (let index = 1; index < tone.length; index++) {
    const from = tone[index - 1];
    const to = tone[index];
    intervals.push({
      duration: (positions[index] - positions[index - 1]) * duration,
      from,
      to,
      rate: targetRate(from, to),
    });
  }
  return intervals;
}

/** Coefficients of the approach to the target `m·t + b` from `state`. */
function coefficients(state, slope, offset, rate) {
  const c1 = state.value - offset + (3 * slope) / rate;
  const c2 = state.velocity + c1 * rate - slope;
  const c3 = (state.acceleration + 2 * c2 * rate - c1 * rate ** 2) / 2;
  return [c1, c2, c3];
}

/** Value, velocity and acceleration at `t` of one interval. */
function evaluate([c1, c2, c3], slope, offset, rate, t) {
  const decay = Math.exp(-rate * t);
  const polynomial = c1 + c2 * t + c3 * t * t;
  const derivative = c2 + 2 * c3 * t;
  return {
    value: slope * t + offset - (3 * slope) / rate + polynomial * decay,
    velocity: slope + (derivative - rate * polynomial) * decay,
    acceleration:
      (2 * c3 - 2 * rate * derivative + rate ** 2 * polynomial) * decay,
  };
}

/**
 * Approach a sequence of targets (semitones). Frame `k` is at `k /
 * frameRate` seconds from the start of the first interval; there is one
 * frame per started frame period of the total duration.
 * @param {{duration: number, from: number, to: number, rate: number}[]} intervals
 *   Target `x(t) = from + (to − from)·t / duration` with the rate `λ`.
 * @param {{value: number, velocity: number, acceleration: number}|null} state
 *   Start state; `null` starts at `from` of the first interval at rest.
 * @param {number} frameRate Frames per second.
 * @returns {{values: Float64Array, state: {value: number, velocity: number, acceleration: number}}}
 */
export function approachTargets(intervals, state, frameRate) {
  const total = intervals.reduce((sum, item) => sum + item.duration, 0);
  // A tiny tolerance keeps an exact number of frames when the durations
  // are whole frame periods.
  const count = Math.max(0, Math.ceil(total * frameRate - 1e-9));
  const values = new Float64Array(count);
  let current = state ?? {
    value: intervals[0]?.from ?? 0,
    velocity: 0,
    acceleration: 0,
  };
  let start = 0;
  let frame = 0;
  intervals.forEach((interval, index) => {
    const { duration, from, to, rate } = interval;
    const slope = duration > 0 ? (to - from) / duration : 0;
    const terms = coefficients(current, slope, from, rate);
    const end = start + duration;
    const last = index === intervals.length - 1;
    while (frame < count) {
      const time = frame / frameRate;
      if (!last && time >= end - 1e-9) {
        break;
      }
      values[frame] = evaluate(terms, slope, from, rate, time - start).value;
      frame++;
    }
    current = evaluate(terms, slope, from, rate, duration);
    start = end;
  });
  return { values, state: current };
}

/**
 * Pitch curve of one syllable in semitones around level 3, for tone
 * recognition (issue 70) and plots.
 * @param {number[]|null|undefined} tone Chao levels; empty or missing for
 *   the neutral tone.
 * @param {{start?: number, scale?: number, duration?: number, count?: number, previous?: number[]|null}} [options]
 *   `start`: pitch (st) at the start of the syllable, by default the first
 *   target; `scale`: semitones per level (2); `duration`: seconds (0.2);
 *   `count`: number of values, evenly spaced from the start to the end
 *   (20); `previous`: the tone before it, which sets the neutral level.
 * @returns {number[]}
 */
export function toneCurve(tone, options = {}) {
  const scale = options.scale ?? 2;
  const duration = options.duration ?? 0.2;
  const count = Math.max(1, Math.round(options.count ?? 20));
  const intervals = scaledToneIntervals(
    tone,
    duration,
    scale,
    options.previous
  );
  const state =
    options.start === undefined
      ? null
      : { value: options.start, velocity: 0, acceleration: 0 };
  // Sample `count` points from 0 to `duration` inclusive: the last one is
  // the end state.
  const frameRate = count > 1 ? (count - 1) / duration : 1 / duration;
  const { values, state: end } = approachTargets(intervals, state, frameRate);
  const curve = Array.from(values.slice(0, count - 1));
  curve.push(end.value);
  return curve.slice(0, count);
}

/** Shared synthesis targets, in semitones relative to Chao level 3. */
export function scaledToneIntervals(tone, duration, scale, previous) {
  const neutral = !tone?.length;
  const levels = toneIntervals(
    neutral ? [neutralLevel(previous)] : tone,
    duration
  );
  return levels.map(({ from, to, rate, ...interval }) => ({
    ...interval,
    rate: neutral ? TONE_RATES.neutral : rate,
    from: (from - 3) * scale,
    to: (to - 3) * scale,
  }));
}

/** Evaluate a target trajectory at sorted, arbitrary times within it. */
export function sampleToneTargets(intervals, initial, times) {
  let state = initial;
  let start = 0;
  let i = 0;
  const values = [];
  for (const { duration, from, to, rate } of intervals) {
    const slope = (to - from) / duration;
    const terms = coefficients(state, slope, from, rate);
    const end = start + duration;
    while (i < times.length && times[i] <= end + 1e-9) {
      values.push(evaluate(terms, slope, from, rate, times[i++] - start).value);
    }
    state = evaluate(terms, slope, from, rate, duration);
    start = end;
  }
  return values;
}
