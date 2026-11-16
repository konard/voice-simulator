/**
 * The mode of speech: how a stretch of text is spoken (loud, fast,
 * whispered, angry, ...). The SSML subset (`ssml.js`), the inline tags
 * (`inline.js`) and the ExtIPA/VoQS marks of an IPA string
 * (`src/ipa/parse.js`) all end in mode objects, and the planner turns the
 * spans of words that share one into `plan.modes`, spans in seconds.
 *
 * A mode has every field of `MODE_DEFAULTS`. Markup changes it with a
 * *change*: an object with some of the same fields that `composeMode`
 * applies to the mode around it (the outer mode):
 *
 * - `rate` and `range` multiply, `pitch` and `gain` add, every other field
 *   is replaced by the inner value (`phonation` field by field);
 * - `absolute: ['rate', 'pitch', ...]` lists the fields whose values
 *   replace instead (labels such as `rate="fast"` or `pitch="200Hz"`);
 * - `effort` sets both `effort` and `effortEnd` (unless `effortEnd` is
 *   given too); `effortBy` moves both by an amount; `effortRamp` sets
 *   `effortEnd` to `effort + effortRamp` (crescendo, diminuendo); a
 *   change that sets `effort` also sets `lombard` (false unless given).
 *
 * The values are clamped after composing: rate 0.25 to 4, pitch -24 to 24
 * semitones, range 0 to 4, gain -120 to 12 dB, effort 0 to 1.
 */

/** Phonation values: 0..1, `tension` -1 (lax) .. 1 (pressed). */
const PHONATION_DEFAULTS = Object.freeze({
  breathy: 0,
  creaky: 0,
  tension: 0,
  falsetto: 0,
  harsh: 0,
  whisper: 0,
});

const EMOTION_DEFAULTS = Object.freeze({
  name: 'neutral',
  intensity: 0,
  arousal: 0,
  valence: 0,
  dominance: 0,
});

/**
 * Names of the intonation tunes (src/articulation/intonation.js) that a
 * span can set as `mode.tune`: the generic English tunes and the Russian
 * constructions IK1 to IK7. Written as `{IK4 … IK4}` in IPA,
 * `[tune IK4]…[/tune]` inline and `<vs:tune name="IK4">` in SSML.
 */
export const TUNE_LABELS = Object.freeze([
  'statement',
  'wh',
  'yesno',
  'echo',
  'continuation',
  'alt-rise',
  'tag-ask',
  'tag-confirm',
  'exclamation',
  'command',
  'parenthesis',
  'call',
  'IK1',
  'IK2',
  'IK3',
  'IK4',
  'IK5',
  'IK6',
  'IK7',
]);

/** The neutral mode: every span starts from it. */
export const MODE_DEFAULTS = Object.freeze({
  effort: 0.5, // 0 very soft, 0.25 soft, 0.5 normal, 0.75 loud, 1 shout
  effortEnd: 0.5, // effort at the end of the span (ramps)
  lombard: false, // speech in noise: only stressed vowels get longer
  gain: 0, // plain level change in dB, no change of voice quality
  rate: 1, // speed factor: 2 means half the durations
  pitch: 0, // shift in semitones
  range: 1, // factor on pitch movements
  emphasis: 0, // -0.5 reduced, 0 none, 0.5 moderate, 1 strong
  phonation: PHONATION_DEFAULTS,
  emotion: EMOTION_DEFAULTS,
  tune: null, // optional intonation label
  lang: null, // language tag of the span or null
});

/** Field names of a mode, in order. */
export const MODE_FIELDS = Object.freeze(Object.keys(MODE_DEFAULTS));

/** Effort of the level names (`vs:effort level`, inline tags). */
export const EFFORT_LEVELS = Object.freeze({
  soft: 0.25,
  normal: 0.5,
  loud: 0.75,
  shout: 1,
});

/** Effort of the Lombard preset (`[lombard]`, `level="lombard"`). */
export const LOMBARD_EFFORT = EFFORT_LEVELS.loud;

/** Speech rate of the tempo names. */
export const RATE_LEVELS = Object.freeze({ fast: 1.3, slow: 0.75 });

/** Default degree of a phonation or emotion without one. */
export const DEFAULT_DEGREE = 0.67;

/**
 * Emotion names with their place in arousal, valence and dominance
 * (-1..1) at full intensity: rounded positions from the PAD studies of
 * Russell and Mehrabian (1977), table 3, and Mehrabian (1996).
 */
export const EMOTIONS = Object.freeze({
  neutral: Object.freeze([0, 0, 0]),
  happy: Object.freeze([0.5, 0.8, 0.4]),
  sad: Object.freeze([-0.4, -0.6, -0.3]),
  angry: Object.freeze([0.6, -0.5, 0.3]),
  afraid: Object.freeze([0.6, -0.6, -0.4]),
  surprised: Object.freeze([0.7, 0.4, -0.1]),
  disgusted: Object.freeze([0.3, -0.6, 0.3]),
  tender: Object.freeze([-0.2, 0.6, -0.1]),
  bored: Object.freeze([-0.6, -0.4, -0.2]),
  sarcastic: Object.freeze([0.2, -0.3, 0.4]),
  confident: Object.freeze([0.2, 0.5, 0.6]),
  hesitant: Object.freeze([-0.2, -0.1, -0.5]),
});

/** Degrees of the IPA degree digits 1, 2 (or none) and 3. */
export const DEGREES = Object.freeze([0.33, 0.67, 1]);

/** Whisper of a whispery voice: 0.25, 0.5 and 0.75 at the three degrees. */
function whisperyLevel(degree) {
  const step = DEGREES.indexOf(degree);
  return step >= 0 ? 0.25 * (step + 1) : Math.round(degree * 750) / 1000;
}

/** Names of the phonation types and the change each makes at `degree`. */
export const PHONATIONS = Object.freeze({
  modal: () => ({ phonation: { ...PHONATION_DEFAULTS } }),
  breathy: (degree) => ({ phonation: { breathy: degree } }),
  creaky: (degree) => ({ phonation: { creaky: degree } }),
  pressed: (degree) => ({ phonation: { tension: degree } }),
  lax: (degree) => ({ phonation: { tension: -degree } }),
  falsetto: (degree) => ({ phonation: { falsetto: degree } }),
  harsh: (degree) => ({ phonation: { harsh: degree } }),
  whisper: () => ({ phonation: { whisper: 1 } }),
  whispery: (degree) => ({ phonation: { whisper: whisperyLevel(degree) } }),
});

/** Names of the non-speech sounds (`vs:sound`, `[laugh]`, `⸨laugh⸩`). */
export const SOUND_NAMES = Object.freeze([
  'laugh',
  'inhale',
  'exhale',
  'sigh',
  'cough',
  'throat',
  'filler',
  'click',
]);

/** Seconds of a sound without a duration (silence until it is modelled). */
export const SOUND_DURATION = 0.3;

const LIMITS = Object.freeze({
  rate: [0.25, 4],
  pitch: [-24, 24],
  range: [0, 4],
  gain: [-120, 12],
  effort: [0, 1],
  effortEnd: [0, 1],
});

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/**
 * A full mode from `fields` (missing fields from `MODE_DEFAULTS`), with its
 * own `phonation` and `emotion` objects.
 * @param {object} [fields]
 */
export function createMode(fields = {}) {
  return {
    ...MODE_DEFAULTS,
    ...fields,
    phonation: { ...PHONATION_DEFAULTS, ...fields.phonation },
    emotion: { ...EMOTION_DEFAULTS, ...fields.emotion },
  };
}

/**
 * The emotion of a name at an intensity, or of explicit arousal, valence
 * and dominance.
 * @param {{name?: string, intensity?: number, arousal?: number, valence?: number, dominance?: number}} spec
 */
export function emotionOf(spec) {
  const name = spec.name ?? 'neutral';
  const intensity =
    spec.intensity ?? (spec.name && name !== 'neutral' ? DEFAULT_DEGREE : 0);
  const [arousal, valence, dominance] = Object.hasOwn(EMOTIONS, name)
    ? EMOTIONS[name]
    : EMOTIONS.neutral;
  const value = (given, base) =>
    clamp(given ?? Math.round(base * intensity * 1000) / 1000, [-1, 1]);
  return {
    name,
    intensity: clamp(intensity, [0, 1]),
    arousal: value(spec.arousal, arousal),
    valence: value(spec.valence, valence),
    dominance: value(spec.dominance, dominance),
  };
}

function composeEffort(mode, change) {
  if (change.effort !== undefined) {
    mode.effort = change.effort;
    mode.effortEnd = change.effortEnd ?? change.effort;
    mode.lombard = change.lombard ?? false;
  } else if (change.effortBy !== undefined) {
    mode.effort += change.effortBy;
    mode.effortEnd += change.effortBy;
  } else if (change.effortEnd !== undefined) {
    mode.effortEnd = change.effortEnd;
  }
  if (change.effortRamp !== undefined) {
    mode.effortEnd = clamp(mode.effort, LIMITS.effort) + change.effortRamp;
  }
}

/** Round away the binary noise of products and sums (1.3 * 0.75 ...). */
const tidy = (value) => Math.round(value * 1e9) / 1e9;

/**
 * Apply a change to the outer mode: `rate` and `range` multiply, `pitch`
 * and `gain` add, the other fields are replaced. The fields listed in
 * `change.absolute` replace too. The result is clamped.
 * @param {object} outer A full mode.
 * @param {object} change
 * @returns {object} A new full mode.
 */
export function composeMode(outer, change = {}) {
  const mode = createMode(outer);
  const absolute = new Set(change.absolute ?? []);
  for (const name of ['rate', 'range']) {
    if (change[name] !== undefined) {
      mode[name] = absolute.has(name)
        ? change[name]
        : tidy(mode[name] * change[name]);
    }
  }
  for (const name of ['pitch', 'gain']) {
    if (change[name] !== undefined) {
      mode[name] = absolute.has(name)
        ? change[name]
        : tidy(mode[name] + change[name]);
    }
  }
  composeEffort(mode, change);
  for (const name of ['emphasis', 'tune', 'lang']) {
    if (change[name] !== undefined) {
      mode[name] = change[name];
    }
  }
  if (change.phonation) {
    Object.assign(mode.phonation, change.phonation);
  }
  if (change.emotion) {
    mode.emotion = { ...EMOTION_DEFAULTS, ...change.emotion };
  }
  for (const [name, range] of Object.entries(LIMITS)) {
    mode[name] = tidy(clamp(mode[name], range));
  }
  return mode;
}

/** A string that is equal for equal modes. */
export function modeKey(mode) {
  const full = createMode(mode);
  return JSON.stringify(
    MODE_FIELDS.map((name) =>
      typeof full[name] === 'object' && full[name] !== null
        ? Object.values(full[name])
        : full[name]
    )
  );
}

const DEFAULT_KEY = modeKey(MODE_DEFAULTS);

/** Whether a mode is the neutral mode. */
export function isDefaultMode(mode) {
  return !mode || modeKey(mode) === DEFAULT_KEY;
}

/** Level change in decibels of an effort (0..1): -20 to +20 dB. */
export function effortDecibels(effort) {
  return (effort - 0.5) * 40;
}
