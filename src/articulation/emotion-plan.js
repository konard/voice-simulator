/**
 * Emotions in the plan (issue 55). `realiseEmotions()` turns the emotion
 * of every token mode into changes of its other fields
 * (`emotionChanges()`, src/articulation/emotion.js), composed as if the
 * emotion were an outer span: the fields that the markup of the span set
 * itself win, so `[angry][soft]…[/soft][/angry]` stays soft (effort 0.25)
 * while rate and range multiply and pitch adds. The realised mode keeps the
 * emotion and gets the extra fields `pauses`, `stressLength`, `glide`,
 * `finalRise`, `precision` and `smile`; the rest of the planner reads them
 * here:
 *
 * - `applyEmotionSegments()` scales the pauses and the primary-stressed
 *   vowels, spreads or centralises the vowel targets (`precision`) and
 *   spreads the lips of the vowels (`smile`);
 * - `addEmotionPitch()` moves the planned f0 of every span with an
 *   emotion: its contour (in semitones) is scaled by the emotion's
 *   `range` around the median of its vowels and shifted by the emotion's
 *   `pitch`, as the profiles of Burkhardt and Sendlmeier (2000) measure
 *   them (a mean and a range); then the glide of the primary-stressed
 *   vowels and the final rise of the last vowel of the span are added.
 *
 * The pitch of an emotion is the change of the median f0 that the
 * profiles measured. A raised effort (angry, happy) raises the pitch on
 * top of it (EFFORT_RULES.pitch, issue 52); the fall of a lowered effort
 * (sad, bored, tender) is already part of the measured fall, so the
 * planner takes it back. The emotion's own `pitch` and `range` therefore
 * stay out of `mode.pitch` and `mode.range` (the span's own values, which
 * the tunes realise): they are `mode.emotionPitch` and
 * `mode.emotionRange`.
 *
 * Since the markup only keeps the composed mode of a span, a value that a
 * span sets back to its default (`[normal]`, `[modal]`) inside an emotion
 * cannot be told from no value: the emotion's value applies.
 *
 * Unlicense (public domain).
 */

import {
  MODE_DEFAULTS,
  composeMode,
  createMode,
  effortDecibels,
} from '../markup/modes.js';
import { PHONATION_SOURCE } from '../acoustics/glottis.js';
import { EFFORT_RULES } from './effort.js';
import { NEUTRAL_VOWEL } from './phones.js';
import {
  GLIDE_LIMIT,
  PRECISION,
  SMILE,
  emotionChanges,
  isNeutralEmotion,
} from './emotion.js';

/** The fields of the span itself: everything that is not its default. */
function ownChange(mode) {
  const change = {
    rate: mode.rate,
    range: mode.range,
    pitch: mode.pitch,
    gain: mode.gain,
    emphasis: mode.emphasis,
    tune: mode.tune,
    lang: mode.lang,
    emotion: mode.emotion,
  };
  if (
    mode.effort !== MODE_DEFAULTS.effort ||
    mode.effortEnd !== MODE_DEFAULTS.effortEnd ||
    mode.lombard
  ) {
    Object.assign(change, {
      effort: mode.effort,
      effortEnd: mode.effortEnd,
      lombard: mode.lombard,
    });
  }
  const phonation = Object.entries(mode.phonation ?? {}).filter(
    ([, value]) => value !== 0
  );
  if (phonation.length > 0) {
    change.phonation = Object.fromEntries(phonation);
  }
  return change;
}

/**
 * The mode with its emotion realised; the same object when the emotion
 * changes nothing (neutral, or intensity 0), so plain text keeps its plan.
 * @param {object} mode a full mode
 * @returns {object}
 */
export function realiseEmotion(mode) {
  if (!mode || isNeutralEmotion(mode.emotion)) {
    return mode;
  }
  const changes = emotionChanges(mode.emotion);
  const phonation = { ...changes.phonation };
  if (changes.jitter > 0) {
    phonation.harsh = Math.min(
      1,
      (phonation.harsh ?? 0) + changes.jitter / PHONATION_SOURCE.harshJitter
    );
  }
  const outer = composeMode(createMode(), {
    rate: changes.rate,
    effort: changes.effort,
    phonation,
  });
  const realised = composeMode(outer, ownChange(mode));
  return Object.assign(realised, {
    emotionPitch: changes.pitch,
    emotionRange: changes.range,
    emotionEffort: changes.effort,
    pauses: changes.pauses,
    stressLength: changes.stressLength,
    glide: changes.glide,
    finalRise: changes.finalRise,
    precision: changes.precision,
    smile: changes.smile,
  });
}

/**
 * Replace the mode of every token by its realised mode (one realised
 * object per mode object, so the spans of `planModes()` stay merged).
 * @param {object[]} tokens tokens with `mode` (assignTokenModes)
 */
export function realiseEmotions(tokens) {
  const realised = new Map();
  for (const token of tokens) {
    const { mode } = token;
    if (!mode || isNeutralEmotion(mode.emotion)) {
      continue;
    }
    if (!realised.has(mode)) {
      realised.set(mode, realiseEmotion(mode));
    }
    token.mode = realised.get(mode);
  }
  return tokens;
}

const clampUnit = (value) => Math.min(1, Math.max(0, value));

/** Factor of `precision` p on the distance of a vowel from [ə]. */
export function precisionFactor(precision) {
  return precision >= 0
    ? 1 + PRECISION.up * precision
    : Math.max(0, 1 + PRECISION.down * precision);
}

function spreadVowel(segment, precision) {
  const factor = precisionFactor(precision);
  const vowel = { ...segment.vowel };
  for (const name of ['height', 'backness']) {
    vowel[name] = clampUnit(
      NEUTRAL_VOWEL[name] + (vowel[name] - NEUTRAL_VOWEL[name]) * factor
    );
  }
  segment.vowel = vowel;
}

function smileVowel(segment, smile) {
  segment.vowel = {
    ...segment.vowel,
    rounding: clampUnit(segment.vowel.rounding - SMILE.rounding * smile),
  };
  if (segment.target.rounding !== undefined) {
    segment.target = {
      ...segment.target,
      rounding: clampUnit(segment.target.rounding - SMILE.rounding * smile),
    };
  }
  // Spread lips are drawn back: the tract gets shorter at the lips (see
  // protrusionTarget() of plan.js).
  segment.lipSpread = SMILE.retraction * smile;
}

/**
 * Durations and vowel targets of the emotions of the spans: the last
 * vowel of a span with a final rise lasts at least `finalRiseLength()`
 * (a rise needs time, RISE_TIME), `pauses` on every pause (timed pauses
 * and sounds keep their length), `stressLength` on primary-stressed
 * vowels, `precision` and `smile` on every vowel.
 * @param {object[]} segments segments of buildSegments()
 */
export function applyEmotionSegments(segments) {
  const vowels = segments.filter((segment) => segment.kind === 'vowel');
  vowels.forEach((segment, index) => {
    const mode = segment.token.mode;
    if (mode?.finalRise > 0 && lastOfSpan(vowels, index)) {
      segment.duration = Math.max(
        segment.duration,
        finalRiseLength(mode.finalRise)
      );
    }
  });
  for (const segment of segments) {
    const mode = segment.token?.mode;
    if (!mode || mode.pauses === undefined) {
      continue;
    }
    if (segment.kind === 'pause') {
      if (!segment.timed) {
        segment.duration *= mode.pauses;
      }
      continue;
    }
    if (segment.kind !== 'vowel') {
      continue;
    }
    if (segment.token.stress === 1) {
      segment.duration *= mode.stressLength;
    }
    if (mode.precision !== 0) {
      spreadVowel(segment, mode.precision);
    }
    if (mode.smile > 0) {
      smileVowel(segment, mode.smile);
    }
  }
}

/**
 * A straight movement of `slope` semitones per second across the frames
 * of a segment, zero at its middle and at most GLIDE_LIMIT in total.
 */
function addMovement(f0, segment, slope, frameRate) {
  const first = Math.max(0, Math.round(segment.start * frameRate));
  const last = Math.min(f0.length, Math.round(segment.end * frameRate));
  const length = segment.end - segment.start;
  if (last <= first || length <= 0) {
    return;
  }
  const total = movementOf(slope, length);
  const middle = (segment.start + segment.end) / 2;
  for (let frame = first; frame < last; frame++) {
    const offset = (total * (frame / frameRate - middle)) / length;
    f0[frame] *= 2 ** (offset / 12);
  }
}

/**
 * Time a pitch rise of `d` semitones needs at least: 89.6 + 8.7 d ms
 * (Xu & Sun 2002, the maximum speed of pitch change, rises).
 */
export const RISE_TIME = Object.freeze({ base: 0.0896, perSemitone: 0.0087 });

/** The movement (semitones) of a slope over a vowel, at most GLIDE_LIMIT. */
function movementOf(slope, seconds) {
  return Math.max(-GLIDE_LIMIT, Math.min(GLIDE_LIMIT, slope * seconds));
}

/**
 * The length a vowel needs for a final rise of `slope` st/s: the shortest
 * time t with slope · t (at most GLIDE_LIMIT) that RISE_TIME allows.
 */
export function finalRiseLength(slope) {
  if (!(slope > 0)) {
    return 0;
  }
  const { base, perSemitone } = RISE_TIME;
  const free = base / (1 - perSemitone * slope);
  const limited = base + perSemitone * GLIDE_LIMIT;
  return slope * free <= GLIDE_LIMIT && free > 0 ? free : limited;
}

/** Whether a vowel is the last of its span (the next vowel has another mode). */
function lastOfSpan(vowels, index) {
  return vowels[index + 1]?.token?.mode !== vowels[index].token.mode;
}

/** Runs of segments with the same realised emotion mode. */
function emotionGroups(segments) {
  const groups = [];
  for (const segment of segments) {
    const mode = segment.token?.mode;
    const last = groups.at(-1);
    if (mode?.pauses === undefined) {
      if (last && !segment.token) {
        last.open = false;
      }
      continue;
    }
    if (last && last.open && last.mode === mode) {
      last.segments.push(segment);
    } else {
      groups.push({ mode, segments: [segment], open: true });
    }
  }
  return groups;
}

/** Median of the f0 (semitones re `reference`) of the vowels of a group. */
function vowelMedian(f0, segments, reference, frameRate) {
  const values = [];
  for (const segment of segments) {
    if (segment.kind !== 'vowel') {
      continue;
    }
    const first = Math.max(0, Math.round(segment.start * frameRate));
    const last = Math.min(f0.length, Math.round(segment.end * frameRate));
    for (let frame = first; frame < last; frame++) {
      values.push(12 * Math.log2(f0[frame] / reference));
    }
  }
  if (values.length === 0) {
    return 0;
  }
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

/**
 * The shift (semitones) that the emotion adds to the median: its pitch,
 * minus the fall of its own lowered effort (see the header).
 */
function emotionShift(mode, head) {
  const fall = Math.min(
    0,
    EFFORT_RULES.pitch.value(effortDecibels(mode.emotionEffort), head)
  );
  return mode.emotionPitch - fall;
}

/** First and last (exclusive) frame of a segment or a run of them. */
function framesOf(from, to, frameRate, count) {
  return [
    Math.max(0, Math.round(from.start * frameRate)),
    Math.min(count, Math.round(to.end * frameRate)),
  ];
}

/**
 * The final rise: the vowel loses the movement of the tune (it is held at
 * the f0 of its middle) and rises by `slope` around its middle; the f0
 * after it, to the end of the span, keeps the height it reached. The rise
 * is written into `shape` as well, so the smoothing of smoothPitch()
 * (plan.js) keeps it, as it keeps the contour tones.
 */
function addFinalRise(f0, shape, vowel, end, slope, frameRate) {
  const [first, last] = framesOf(vowel, vowel, frameRate, f0.length);
  const length = vowel.end - vowel.start;
  if (last <= first || length <= 0) {
    return;
  }
  const level = f0[Math.min(last - 1, (first + last) >> 1)];
  const total = movementOf(slope, length);
  const middle = (vowel.start + vowel.end) / 2;
  const stop = Math.min(f0.length, end);
  for (let frame = first; frame < stop; frame++) {
    const time = Math.min(frame / frameRate, vowel.end);
    const factor = 2 ** ((total * (time - middle)) / length / 12);
    if (frame < last) {
      f0[frame] = level * factor;
    } else {
      f0[frame] *= factor;
    }
    if (shape) {
      shape[frame] *= factor;
    }
  }
}

/**
 * Pitch of the emotions: scale the contour of every span with an emotion
 * by its range around the median of its vowels and shift it by its
 * pitch, then add the `glide` of each primary-stressed vowel and the
 * `finalRise` of the last vowel of the span.
 * @param {Float32Array} f0 planned f0 (Hz)
 * @param {object[]} segments timed segments
 * @param {number} frameRate
 * @param {{pitch: number}} head
 * @param {Float32Array} [shape] the contour shape of fillPitch()
 */
export function addEmotionPitch(f0, segments, frameRate, head, shape) {
  for (const { mode, segments: group } of emotionGroups(segments)) {
    const median = vowelMedian(f0, group, head.pitch, frameRate);
    const shift = emotionShift(mode, head);
    const range = mode.emotionRange;
    const [first, last] = framesOf(
      group[0],
      group.at(-1),
      frameRate,
      f0.length
    );
    for (let frame = first; frame < last; frame++) {
      const value = 12 * Math.log2(f0[frame] / head.pitch);
      const moved = median + range * (value - median) + shift;
      f0[frame] = head.pitch * 2 ** (moved / 12);
    }
    const vowels = group.filter((segment) => segment.kind === 'vowel');
    for (const vowel of vowels) {
      if (vowel.token.stress === 1 && mode.glide !== 0) {
        addMovement(f0, vowel, mode.glide, frameRate);
      }
    }
    if (mode.finalRise !== 0 && vowels.length > 0) {
      addFinalRise(f0, shape, vowels.at(-1), last, mode.finalRise, frameRate);
    }
  }
}
