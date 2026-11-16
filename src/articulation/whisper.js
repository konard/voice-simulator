/**
 * Whisper in the plan (issue 53). The `whisper` channel (0..1) says how
 * much of the voice source is the noise of a half-open glottis and how
 * little is fold vibration: 0 is a modal voice, 1 a whisper, values between a
 * whispery voice (pulses and noise). It comes from
 *
 * - `mode.phonation.whisper` of a span (`[whisper]`, `{W … W}`,
 *   `<vs:phonation name="whisper">`, `<vs:effort level="whisper">`, and
 *   0.25 to 0.75 for a whispery voice, `{Ṿ … Ṿ}`);
 * - 1 for a single whispered phone (U+0323 dot below, `ạ`);
 * - 1 for a voiceless vowel or sonorant (U+0325 ring below, `ḁ`, `l̥`):
 *   it gets the whisper source, so its voicing target becomes 1 (the
 *   source drive) while the folds do not vibrate.
 *
 * A whisper span also lasts longer: every segment in it (timed pauses and
 * sounds excepted) is `1 + WHISPER_DURATION * whisper` times as long
 * (Schwartz 1972; Tartter 1989: whispered syllables are about a third
 * longer). The source (src/acoustics/glottis.js) realises the rest.
 */

/** Lengthening of the segments of a whisper span at whisper 1. */
export const WHISPER_DURATION = 0.3;

/** Manners of sonorant consonants (they get whispered when voiceless). */
const SONORANTS = new Set([
  'nasal',
  'approximant',
  'lateral-approximant',
  'trill',
  'tap',
]);

/**
 * Whether a token is a vowel or a sonorant written voiceless (U+0325 or
 * U+030A): it is whispered.
 * @param {object} [token]
 */
export function isVoicelessSonorant(token) {
  if (!token || token.voiced !== false) {
    return false;
  }
  return token.kind === 'vowel' || SONORANTS.has(token.phoneme?.manner ?? '');
}

/**
 * The whisper of a segment: 1 for a whispered phone or a voiceless vowel
 * or sonorant, else the whisper of its mode (0 without a token).
 * @param {{token?: object}} segment
 */
export function segmentWhisper(segment) {
  const { token } = segment;
  if (!token) {
    return 0;
  }
  if (token.whispered || isVoicelessSonorant(token)) {
    return 1;
  }
  return Math.min(1, Math.max(0, token.mode?.phonation?.whisper ?? 0));
}

/**
 * Give the segments of voiceless vowels and sonorants the voicing target 1:
 * with whisper 1 that drives the whisper noise and no pulses.
 * @param {object[]} segments segments of `buildSegments()`
 */
export function whisperVoiceless(segments) {
  for (const segment of segments) {
    if (isVoicelessSonorant(segment.token) && segment.target) {
      segment.target = { ...segment.target, voicing: 1 };
    }
  }
}

/**
 * Multiply the durations of the segments of a whisper span by
 * `1 + WHISPER_DURATION * whisper` (timed pauses and sounds keep theirs).
 * @param {object[]} segments segments of `buildSegments()`, before timing
 */
export function applyWhisperDurations(segments) {
  for (const segment of segments) {
    const whisper = segment.token?.mode?.phonation?.whisper ?? 0;
    if (whisper > 0 && !segment.timed) {
      segment.duration *= 1 + WHISPER_DURATION * Math.min(1, whisper);
    }
  }
}

/**
 * Whether a segment has no voicing target (a pause, a voiceless consonant
 * or its release): the whisper does not drive it.
 * @param {{target?: {voicing?: number}}} segment
 */
function isUnvoiced(segment) {
  return !((segment.target?.voicing ?? 0) > 0);
}

/**
 * The whisper of each segment: `segmentWhisper()`, and for a run of
 * unvoiced segments (pauses, voiceless consonants) the larger whisper of
 * the voiced segments on either side. The glottis of a whisperer stays
 * open through them; it changes nothing there (the drive is whisper times
 * voicing), but it lets the smoothed channel reach the whisper of a short
 * whispered vowel before the vowel starts (`ˈhḁ`, `{W ˈi W}`), so that no
 * pulses are left in it.
 * @param {object[]} segments timed segments
 * @returns {number[]}
 */
export function segmentWhispers(segments) {
  const own = segments.map(segmentWhisper);
  const result = own.slice();
  let index = 0;
  while (index < segments.length) {
    if (!isUnvoiced(segments[index])) {
      index++;
      continue;
    }
    let end = index;
    while (end < segments.length && isUnvoiced(segments[end])) {
      end++;
    }
    const before = index > 0 ? own[index - 1] : 0;
    const after = end < segments.length ? own[end] : 0;
    for (let at = index; at < end; at++) {
      result[at] = Math.max(own[at], before, after);
    }
    index = end;
  }
  return result;
}

/**
 * Fill the whisper channel with the whisper of each segment
 * (`segmentWhispers()`), a step function that the planner smooths.
 * @param {Float32Array} values
 * @param {object[]} segments timed segments
 * @param {number} frameRate
 * @returns {Float32Array|null} `values` when any frame whispers, else null
 */
export function fillWhisper(values, segments, frameRate) {
  values.fill(0);
  let any = false;
  const whispers = segmentWhispers(segments);
  segments.forEach((segment, index) => {
    const whisper = whispers[index];
    if (whisper === 0) {
      return;
    }
    any = true;
    const first = Math.round(segment.start * frameRate);
    const last = Math.min(values.length, Math.round(segment.end * frameRate));
    values.fill(whisper, first, Math.max(first + 1, last));
  });
  return any ? values : null;
}

/**
 * Whether a plan whispers anywhere (its `whisper` channel is not 0).
 * @param {{channels?: Record<string, ArrayLike<number>>}} plan
 */
export function planWhispers(plan) {
  const values = plan?.channels?.whisper;
  if (!values) {
    return false;
  }
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== 0) {
      return true;
    }
  }
  return false;
}
