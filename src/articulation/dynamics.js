/**
 * Articulator dynamics: every articulator moves like a damped mass that is
 * pulled towards a target (Saltzman & Munhall 1989; Birkholz et al. 2011).
 *
 * A channel is a list of targets `{value, start, end, strength}` (seconds,
 * strength 0 to 1). Inside a target the input of the articulator is
 * `strength * value + (1 - strength) * line`, where `line` is the straight
 * line from the end of the previous target of strength 1 to the start of
 * the next one (it holds the edge value before the first and after the last
 * of them). Strength 1 is a sound with its own target, strength 0 a sound
 * that leaves the articulator free (Keating 1990; Cohn 1990), and values in
 * between are partly resistant consonants (Recasens et al. 1997).
 *
 * The input is anticipated by a lead (Bell-Berti & Harris 1981) and drives
 * `order` equal one-pole low-pass filters in a row, forwards only. Two of
 * them form a critically damped second-order system: a step reaches half
 * of its height after 1.68 time constants and 90 % after 3.89 time
 * constants, without overshoot. A lead of 1.68 time constants keeps the
 * middle of every transition at the boundary between the two sounds, where
 * the zero-phase smoothing of `smoothChannel()` in plan.js put it.
 */

/** Number of cascaded one-pole filters (2 = critically damped; 2 to 6). */
export const DYNAMICS_ORDER = 2;

/** Sub-samples per frame when the input is averaged over a frame. */
const SUBSAMPLES = 4;

/**
 * Shift targets `lead` seconds earlier. Windows stay contiguous: the first
 * target keeps its start and the last its end.
 *
 * With `limited` only the targets of strength 1 move, and never before the
 * end of the previous target of strength 1 (the previous sound with its
 * own target for this channel) unless that one has `limiting: false`.
 * Free sounds keep their start, so the straight line through them starts
 * where the previous own target ends.
 * @param {{value: number, start: number, end: number, strength: number, limiting?: boolean}[]} targets
 * @param {number} lead Seconds.
 * @param {{limited?: boolean}} [options]
 */
export function anticipate(targets, lead, options = {}) {
  if (!(lead > 0) || targets.length === 0) {
    return targets;
  }
  const first = targets[0].start;
  const starts = new Float64Array(targets.length);
  let ownEnd = -Infinity;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (!options.limited) {
      starts[index] = target.start - lead;
    } else if (target.strength >= 1) {
      starts[index] = Math.max(target.start - lead, ownEnd);
    } else {
      starts[index] = target.start;
    }
    if (target.strength >= 1 && target.limiting !== false) {
      ownEnd = target.end;
    }
  }
  starts[0] = first;
  for (let index = targets.length - 2; index > 0; index--) {
    starts[index] = Math.min(starts[index], starts[index + 1]);
  }
  for (let index = 1; index < targets.length; index++) {
    starts[index] = Math.max(starts[index], starts[index - 1], first);
  }
  return targets.map((target, index) => ({
    ...target,
    start: starts[index],
    end: index + 1 < targets.length ? starts[index + 1] : target.end,
  }));
}

/**
 * Per target, the line through the neighbouring targets of strength 1:
 * `[fromTime, fromValue, toTime, toValue]`.
 */
function targetLines(targets, fallback) {
  const lines = new Array(targets.length);
  let from = null;
  for (let index = 0; index < targets.length; index++) {
    lines[index] = [from?.end, from?.value];
    if (targets[index].strength >= 1) {
      from = targets[index];
    }
  }
  let to = null;
  for (let index = targets.length - 1; index >= 0; index--) {
    const line = lines[index];
    let [fromTime, fromValue] = line;
    let toTime = to?.start;
    let toValue = to?.value;
    if (fromValue === undefined) {
      fromValue = toValue ?? fallback;
      fromTime = toTime ?? 0;
    }
    if (toValue === undefined) {
      toValue = fromValue;
      toTime = fromTime;
    }
    lines[index] = [fromTime, fromValue, toTime, toValue];
    if (targets[index].strength >= 1) {
      to = targets[index];
    }
  }
  return lines;
}

function lineValue([fromTime, fromValue, toTime, toValue], time) {
  if (toTime <= fromTime || time <= fromTime) {
    return time >= toTime ? toValue : fromValue;
  }
  if (time >= toTime) {
    return toValue;
  }
  return (
    fromValue +
    ((toValue - fromValue) * (time - fromTime)) / (toTime - fromTime)
  );
}

/**
 * The input of the articulator per frame: the active target (its value
 * mixed with the line by its strength), averaged over each frame so that
 * targets shorter than a frame still count.
 */
function sampleInput(targets, frameRate, frameCount, fallback) {
  const input = new Float32Array(frameCount);
  if (targets.length === 0) {
    return input.fill(fallback);
  }
  const lines = targetLines(targets, fallback);
  let index = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let sub = 0; sub < SUBSAMPLES; sub++) {
      const time = (frame + (sub + 0.5) / SUBSAMPLES - 0.5) / frameRate;
      while (index + 1 < targets.length && time >= targets[index].end) {
        index++;
      }
      const target = targets[index];
      const strength = target.strength ?? 1;
      sum +=
        strength >= 1
          ? target.value
          : strength * target.value +
            (1 - strength) * lineValue(lines[index], time);
    }
    input[frame] = sum / SUBSAMPLES;
  }
  return input;
}

/**
 * Trajectory of one articulator that approaches its targets.
 * @param {{value: number, start: number, end: number, strength?: number}[]} targets
 *   Contiguous targets in time order; times in seconds.
 * @param {number} timeConstant Seconds, of each one-pole filter.
 * @param {number} frameRate Frames per second.
 * @param {number} [order] Number of one-pole filters (0 returns the input).
 * @param {{lead?: number, limited?: boolean, frameCount?: number, fallback?: number}} [options]
 *   `lead`: the input at time t is the target active at t + lead;
 *   `limited`: no target starts before the end of the previous target of
 *   strength 1; `frameCount`: number of frames (default: up to the end of
 *   the last target); `fallback`: the value without any target of strength 1.
 * @returns {Float32Array}
 */
export function approachTargets(
  targets,
  timeConstant,
  frameRate,
  order = DYNAMICS_ORDER,
  options = {}
) {
  const shifted = anticipate(targets, options.lead ?? 0, options);
  const frameCount =
    options.frameCount ?? Math.ceil((targets.at(-1)?.end ?? 0) * frameRate) + 1;
  const values = sampleInput(
    shifted,
    frameRate,
    frameCount,
    options.fallback ?? 0
  );
  const alpha = 1 - Math.exp(-1 / (timeConstant * frameRate));
  for (let pass = 0; pass < order; pass++) {
    let state = values[0];
    for (let frame = 0; frame < frameCount; frame++) {
      state += alpha * (values[frame] - state);
      values[frame] = state;
    }
  }
  return values;
}
