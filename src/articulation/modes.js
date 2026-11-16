/**
 * Speech modes in the plan (see docs/markup.md): the mode spans of an IPA
 * string (word indexes) become a `mode` on every token and spans in
 * seconds on the plan. What the engine realises today:
 *
 * - `rate` divides the durations of the segments of a token (timed pauses
 *   and sounds keep their length);
 * - `pitch` (semitones) and `range` (a factor of the tune's range) move
 *   the pitch targets of intonation.js and, in phrases with tones, of
 *   `syllablePitch()` (src/articulation/prosody.js);
 * - `emphasis` is focus: the nucleus moves to the word, its pitch and
 *   duration grow and what follows is compressed (`FOCUS`, issue 51);
 * - `tune` names the tune of the phrase (`TUNE_NAMES`) and `lang` picks
 *   the tunes of the language (`intonationLanguage()`), intonation.js;
 * - `gain` (dB) scales the loudness channel;
 * - the effort (`E = (effort - 0.5) * 40` dB) fills the `effort` channel,
 *   moving from `effort` to `effortEnd` between the first and the last
 *   vowel of a span, and lengthens vowels;
 *   the planner and the source turn it into level, pitch, tilt, F1 and
 *   noise (src/articulation/effort.js);
 * - a timed pause lasts exactly its `seconds`; a sound is silence of its
 *   length (`SOUND_DURATION`, 0.3 s, unless one is written).
 *
 * `phonation` and `emotion` are carried in the plan and not yet heard.
 */

import {
  MODE_DEFAULTS,
  SOUND_DURATION,
  createMode,
  modeKey,
} from '../markup/modes.js';
import { EFFORT_RULES, spanEffort } from './effort.js';

/**
 * Set `token.mode` on every token from spans in IPA word indexes: a
 * phone takes the span of its word, a pause or a sound the mode of the
 * token before it (a pause belongs to the span before it).
 * @param {object[]} tokens
 * @param {{from: number, to: number, mode: object}[]} spans
 */
export function assignTokenModes(tokens, spans = []) {
  const full = spans.map((span) => ({ ...span, mode: createMode(span.mode) }));
  let previous = MODE_DEFAULTS;
  let span = null;
  for (const token of tokens) {
    const word = token.word ?? -1;
    if (token.kind === 'pause' || token.kind === 'sound' || word < 0) {
      token.mode = previous;
      continue;
    }
    if (!span || word < span.from || word >= span.to) {
      span = full.find((item) => item.from <= word && word < item.to) ?? null;
    }
    token.mode = span ? span.mode : MODE_DEFAULTS;
    previous = token.mode;
  }
  return tokens;
}

/** The length of a timed pause or a sound token, or null. */
export function timedLength(token) {
  if (token?.kind === 'sound') {
    return token.duration ?? SOUND_DURATION;
  }
  return token?.kind === 'pause' && token.seconds !== undefined
    ? token.seconds
    : null;
}

/** Divide the durations of the segments of each token by its rate. */
export function applyRates(segments) {
  for (const segment of segments) {
    const rate = segment.token?.mode?.rate ?? 1;
    if (rate !== 1 && rate > 0 && !segment.timed) {
      segment.duration /= rate;
    }
  }
}

/**
 * Mode spans of a plan in seconds: sorted, not overlapping, from 0 to the
 * end of the last segment; each is `{start, end, ...mode}` with every field
 * of `MODE_DEFAULTS`. A segment without a token (the leading and trailing
 * silence) takes the mode before it.
 * @param {object[]} segments timed segments of `buildSegments()`
 */
export function planModes(segments) {
  const spans = [];
  let mode = MODE_DEFAULTS;
  let key = modeKey(mode);
  const keys = new Map();
  for (const segment of segments) {
    if (segment.token?.mode) {
      mode = segment.token.mode;
      if (!keys.has(mode)) {
        keys.set(mode, modeKey(mode));
      }
      key = keys.get(mode);
    }
    const last = spans.at(-1);
    if (last && last.key === key) {
      last.end = segment.end;
    } else {
      spans.push({ key, start: segment.start, end: segment.end, mode });
    }
  }
  return spans.map(({ start, end, mode: spanMode }) => ({
    start,
    end,
    ...createMode(spanMode),
  }));
}

/** The sounds of a plan: `{name, start, end}` in seconds. */
export function planSounds(segments) {
  return segments
    .filter((segment) => segment.sound)
    .map(({ sound, start, end }) => ({ name: sound, start, end }));
}

/**
 * The mode span of `plan.modes` at `time` (seconds); before the start the
 * first span, after the end the last one.
 * @param {{modes: object[]}} plan
 * @param {number} time
 */
export function modeAt(plan, time) {
  const { modes } = plan;
  let low = 0;
  let high = modes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (modes[middle].start <= time) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return modes[low] ?? { start: 0, end: 0, ...createMode() };
}

/**
 * Call `visit(span, frame, fraction)` for every frame of every span of
 * `plan.modes` that `skip(span)` does not exclude; `fraction` runs from 0
 * at the first frame of a span to 1 at its last. The last span runs to
 * the end of the channel.
 */
function forEachSpanFrame(modes, frameCount, frameRate, skip, visit) {
  for (const span of modes) {
    if (skip(span)) {
      continue;
    }
    const first = Math.max(0, Math.round(span.start * frameRate));
    const last =
      span === modes.at(-1)
        ? frameCount
        : Math.min(frameCount, Math.round(span.end * frameRate));
    const length = Math.max(1, last - first - 1);
    for (let frame = first; frame < last; frame++) {
      visit(span, frame, (frame - first) / length);
    }
  }
}

/**
 * Scale the loudness channel by the plain gain (`gain`, dB) of each span of
 * `plan.modes`, `10^(gain/20)`. The effort is not a gain: it fills its own
 * channel (`fillEffort()`), which the source realises (src/articulation/effort.js).
 * @param {Float32Array} loudness
 * @param {object[]} modes spans of `planModes()`
 * @param {number} frameRate
 */
export function applyModeGains(loudness, modes, frameRate) {
  forEachSpanFrame(
    modes,
    loudness.length,
    frameRate,
    (span) => span.gain === 0,
    (span, frame) => {
      loudness[frame] *= 10 ** (span.gain / 20);
    }
  );
}

/**
 * The time range (seconds) over which the effort of a span moves from
 * `effort` to `effortEnd`: from the end of its first vowel to the start of
 * its last, so that the first vowel keeps the start value and the last has
 * the end value (a span also holds the silence after its last word); the
 * whole span with fewer than two vowels.
 * @param {{start: number, end: number}} span
 * @param {object[]} [segments] timed segments of `buildSegments()`
 */
export function effortRampRange(span, segments = []) {
  const vowels = segments.filter((segment) => {
    const middle = (segment.start + segment.end) / 2;
    return (
      segment.kind === 'vowel' && middle >= span.start && middle < span.end
    );
  });
  const start = vowels[0]?.end;
  const end = vowels.at(-1)?.start;
  return vowels.length > 1 && end > start
    ? { start, end }
    : { start: span.start, end: span.end };
}

/**
 * Fill the effort channel (dB, `E = (effort - 0.5) * 40`) from the spans of
 * `plan.modes`: linear in dB from `effort` to `effortEnd` over the ramp
 * range of a span (`effortRampRange()`), held before and after it, and 0
 * outside spans with an effort.
 * @param {Float32Array} effort
 * @param {object[]} modes spans of `planModes()`
 * @param {number} frameRate
 * @param {object[]} [segments] timed segments, for the ramp ranges
 */
export function fillEffort(effort, modes, frameRate, segments = []) {
  effort.fill(0);
  const ranges = new Map();
  forEachSpanFrame(
    modes,
    effort.length,
    frameRate,
    (span) => span.effort === 0.5 && span.effortEnd === 0.5,
    (span, frame) => {
      if (span.effort === span.effortEnd) {
        effort[frame] = spanEffort(span, 0);
        return;
      }
      if (!ranges.has(span)) {
        ranges.set(span, effortRampRange(span, segments));
      }
      const range = ranges.get(span);
      const fraction =
        (frame / frameRate - range.start) / (range.end - range.start);
      effort[frame] = spanEffort(span, Math.min(1, Math.max(0, fraction)));
    }
  );
  return effort;
}

/**
 * Multiply the duration of vowels by the effort rule (`vowelDuration` of
 * `EFFORT_RULES`) at the effort their token starts with. A Lombard span
 * lengthens only the vowels with primary stress; consonants keep their
 * length.
 * @param {object[]} segments segments of `buildSegments()`, before timing
 */
export function applyEffortDurations(segments) {
  for (const segment of segments) {
    const mode = segment.token?.mode;
    if (segment.kind !== 'vowel' || !mode || mode.effort <= 0.5) {
      continue;
    }
    if (mode.lombard && segment.token.stress !== 1) {
      continue;
    }
    segment.duration *= EFFORT_RULES.vowelDuration.value(spanEffort(mode, 0));
  }
}
