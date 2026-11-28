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

/** Scratch shared by the channels of one plan. */
export function createDynamicsWorkspace(count) {
  return {
    starts: new Float64Array(count),
    shifted: new Array(count),
    a: new Float64Array(count),
    b: new Float64Array(count),
    previous: new Int32Array(count),
  };
}

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
export function anticipate(targets, lead, options = {}, workspace) {
  if (!(lead > 0) || targets.length === 0) {
    return targets;
  }
  const starts = shiftStarts(targets, lead, options, workspace?.starts);
  return shiftWindows(targets, starts, workspace?.shifted);
}

function shiftStarts(
  targets,
  lead,
  { limited },
  starts = new Float64Array(targets.length)
) {
  const first = targets[0].start;
  let ownEnd = -Infinity;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (!limited) {
      starts[index] = target.start - lead;
    } else if ((target.strength ?? 1) >= 1) {
      starts[index] = Math.max(target.start - lead, ownEnd);
    } else {
      starts[index] = target.start;
    }
    if ((target.strength ?? 1) >= 1 && target.limiting !== false) {
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
  return starts;
}

function shiftWindows(targets, starts, shifted = new Array(targets.length)) {
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const output = (shifted[index] ??= {});
    output.value = target.value;
    output.start = starts[index];
    output.end = index + 1 < targets.length ? starts[index + 1] : target.end;
    output.strength = target.strength;
    output.limiting = target.limiting;
  }
  return shifted;
}

/** Slope of the line from the end of `from` to the start of `to`. */
function lineSlope(from, to) {
  return from && to && to.start > from.end
    ? (to.value - from.value) / (to.start - from.end)
    : 0;
}

/** Value at time 0 of that line (it holds a value without both ends). */
function lineBase(from, to, slope, fallback) {
  if (from && to) {
    return slope === 0 && to.start <= from.end
      ? to.value
      : from.value - slope * from.end;
  }
  return from?.value ?? to?.value ?? fallback;
}

/**
 * Per target, the input as `a + b * t`. A target of strength 1 is its
 * value. Any other target lies between the end of the previous target of
 * strength 1 and the start of the next one, where the line between the two
 * is straight, so its mix with the value is linear in time too. Before the
 * first and after the last target of strength 1 the line holds their value
 * (`fallback` without any).
 */
function targetCoefficients(targets, fallback, workspace) {
  const count = targets.length;
  const a = workspace?.a ?? new Float64Array(count);
  const b = workspace?.b ?? new Float64Array(count);
  const previous = workspace?.previous ?? new Int32Array(count);
  let own = -1;
  for (let index = 0; index < count; index++) {
    previous[index] = own;
    if ((targets[index].strength ?? 1) >= 1) {
      own = index;
    }
  }
  let next = -1;
  for (let index = count - 1; index >= 0; index--) {
    const target = targets[index];
    const strength = target.strength ?? 1;
    if (strength >= 1) {
      a[index] = target.value;
      b[index] = 0;
      next = index;
      continue;
    }
    const from = previous[index] < 0 ? null : targets[previous[index]];
    const to = next < 0 ? null : targets[next];
    const slope = lineSlope(from, to);
    const base = lineBase(from, to, slope, fallback);
    a[index] = strength * target.value + (1 - strength) * base;
    b[index] = (1 - strength) * slope;
  }
  return { a, b };
}

/**
 * The input of the articulator per frame: the active target (its value
 * mixed with the line by its strength), averaged over each frame so that
 * targets shorter than a frame still count. Inside one target the input is
 * linear in time, so a frame that lies in one target takes the value at its
 * middle, the same as the mean of the sub-samples.
 */
function sampleInput(targets, frameRate, frameCount, fallback, workspace) {
  const input = new Float32Array(frameCount);
  if (targets.length === 0) {
    return input.fill(fallback);
  }
  const { a, b } = targetCoefficients(targets, fallback, workspace);
  const period = 1 / frameRate;
  const last = targets.length - 1;
  let frame = 0;
  for (let index = 0; index <= last && frame < frameCount; index++) {
    const end = index === last ? Infinity : targets[index].end;
    // Frames that end inside this target: their middle value.
    const inside = Math.min(frameCount, Math.floor(end * frameRate + 0.5));
    for (; frame < inside; frame++) {
      input[frame] = a[index] + b[index] * frame * period;
    }
    // Frames across its end: the mean of the sub-samples.
    for (; frame < frameCount && (frame - 0.5) * period < end; frame++) {
      let sum = 0;
      let sub = index;
      for (let step = 0; step < SUBSAMPLES; step++) {
        const time = (frame + (step + 0.5) / SUBSAMPLES - 0.5) * period;
        while (sub < last && time >= targets[sub].end) {
          sub++;
        }
        sum += a[sub] + b[sub] * time;
      }
      input[frame] = sum / SUBSAMPLES;
    }
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
  const { workspace } = options;
  const shifted = anticipate(targets, options.lead ?? 0, options, workspace);
  const frameCount =
    options.frameCount ?? Math.ceil((targets.at(-1)?.end ?? 0) * frameRate) + 1;
  const values = sampleInput(
    shifted,
    frameRate,
    frameCount,
    options.fallback ?? 0,
    workspace
  );
  const alpha = 1 - Math.exp(-1 / (timeConstant * frameRate));
  if (order === 2) {
    // The usual case, both filters in one pass.
    let first = values[0];
    let second = first;
    for (let frame = 0; frame < frameCount; frame++) {
      first += alpha * (values[frame] - first);
      second += alpha * (first - second);
      values[frame] = second;
    }
    return values;
  }
  for (let pass = 0; pass < order; pass++) {
    let state = values[0];
    for (let frame = 0; frame < frameCount; frame++) {
      state += alpha * (values[frame] - state);
      values[frame] = state;
    }
  }
  return values;
}
