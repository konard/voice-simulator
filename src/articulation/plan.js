/**
 * Utterance planning: IPA tokens -> timed segments -> smooth articulator
 * trajectories sampled at a fixed control rate.
 *
 * Every articulation channel is a list of targets `{value, start, end,
 * strength}` (`channelTargets()`), which src/articulation/dynamics.js turns
 * into a trajectory: a critically damped second-order system per
 * articulator (`ARTICULATORS`: one time constant each; lips and tongue tip
 * are fast, tongue body and velum slower) that starts moving `lead` seconds
 * before the sound it belongs to. Sounds without a target of their own for
 * a channel (vowels for the lips, consonants for the tongue body) let it
 * glide in a straight line between their neighbours; consonants hold the
 * tongue body against that line by their coarticulation resistance
 * (`COARTICULATION_RESISTANCE` in phones.js). Pitch, loudness, the vocal
 * effort (`effort` in dB and `tension`, src/articulation/effort.js) and the
 * fold source keep the zero-phase smoothing of `smoothChannel()`.
 */

import { getPhoneme } from '../ipa/inventory.js';
import { parseIpa } from '../ipa/parse.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { accentHead } from '../accent/head.js';
import { suffixKey } from '../parameters/articulation.js';
import { tensionForPitch } from '../acoustics/folds.js';
import {
  COARTICULATION_RESISTANCE,
  NEUTRAL_VOWEL,
  consonantTarget,
  resistance,
  vowelChannels,
  vowelTarget,
} from './phones.js';
import { DYNAMICS_ORDER, approachTargets } from './dynamics.js';
import {
  applyEffortDurations,
  applyModeGains,
  applyRates,
  assignTokenModes,
  fillEffort,
  planModes,
  planSounds,
  timedLength,
} from './modes.js';
import { approachTargets as approachToneTargets } from './tone-model.js';
import { applyIntonationTiming } from './intonation.js';
import {
  BREATHY_RELEASE,
  PHONATION_CHANNELS,
  breathyReleaseChannels,
  finalCreakAmount,
  isModal,
  phonationChannels,
} from './phonation.js';
import { consonantJaw, teethGap } from './teeth.js';
import {
  EFFORT_RULES,
  effortJaw,
  foldPitchFactor,
  TENSION_PER_DB,
} from './effort.js';
import { LIP_PROTRUSION } from './vowel-space.js';
import {
  durationFeatures,
  durationTable,
  isAspirated,
  scalePause,
  segmentParts,
} from './durations.js';
import {
  boundaryOf,
  pauseDuration,
  pitchTargets,
  pointPositions,
  registerGains,
} from './prosody.js';

export const CONTROL_RATE = 200;

/** Lead of the lips before a rounded sound, seconds (range 0.05 to 0.25). */
export const ROUNDING_LEAD = 0.12;
/** Lead of the velum before a nasal sound, seconds (range 0.03 to 0.15). */
export const VELUM_LEAD = 0.08;
/**
 * Lead of a second-order system with time constant `timeConstant`: the time
 * it needs to cover half of a step, which keeps the middle of a transition
 * at the boundary between two sounds.
 */
const HALF_STEP = 1.68;
/** Limits of the time constants for the fit (seconds). */
const TIME_CONSTANT_MIN = 0.005;
const TIME_CONSTANT_MAX = 0.08;

function articulator(timeConstant, lead, leadRange) {
  const anticipated = lead ?? HALF_STEP * timeConstant;
  const [leadMin, leadMax] = leadRange ?? [anticipated / 2, anticipated * 2];
  return Object.freeze({
    timeConstant,
    lead: anticipated,
    min: TIME_CONSTANT_MIN,
    max: TIME_CONSTANT_MAX,
    leadMin,
    leadMax,
  });
}

/**
 * Articulation channels: time constant of each of the `DYNAMICS_ORDER`
 * one-pole filters and lead in seconds; `min` and `max` bound the time
 * constant and `leadMin` and `leadMax` the lead in
 * experiments/issue-11-fit-dynamics.mjs. `head.articulationSpeed` divides
 * both, `head.coarticulation` multiplies the lead.
 */
export const ARTICULATORS = Object.freeze({
  height: articulator(0.03),
  backness: articulator(0.03),
  rounding: articulator(0.02, ROUNDING_LEAD, [0.05, 0.25]),
  rhotic: articulator(0.025),
  palatalization: articulator(0.02),
  lipAmount: articulator(0.01),
  lipArea: articulator(0.006),
  tongueAmount: articulator(0.012),
  tongueArea: articulator(0.006),
  tongueLocation: articulator(0.012),
  tongueWidth: articulator(0.012),
  velum: articulator(0.022, VELUM_LEAD, [0.03, 0.15]),
  voicing: articulator(0.008),
  aspiration: articulator(0.01),
  glottalClosure: articulator(0.006),
  frication: articulator(0.006),
  sibilance: articulator(0.01),
  trill: articulator(0.01),
  lateral: articulator(0.015),
  // Free articulators (issue 40): the planner sets them from the other
  // channels; voices and emotions move them apart (tract-shape.js). The
  // jaw lags the tongue tip, but reaches the sibilant gap within the 66 ms
  // of a stressed [z] (experiments/issue-40-sibilant-jaw.txt).
  jaw: articulator(0.02),
  lipProtrusion: articulator(0.02, ROUNDING_LEAD, [0.05, 0.25]),
  larynxHeight: articulator(0.04),
  tongueRoot: articulator(0.03),
});

/** Zero-phase smoothing time constants of the source channels, seconds. */
const SOURCE_TIME_CONSTANTS = Object.freeze({
  loudness: 0.018,
  f0: 0.03,
  lungPressure: 0.04,
  adduction: 0.015,
  foldTension: 0.03,
  effort: 0.05,
  tension: 0.03,
  // Phonation types (issue 54, ./phonation.js).
  breath: 0.03,
  creak: 0.03,
  falsetto: 0.03,
  harsh: 0.03,
});

/**
 * All channels of a plan with their time constants in seconds.
 * @deprecated Use `ARTICULATORS` for the articulation channels.
 */
export const CHANNELS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(ARTICULATORS).map(([name, entry]) => [
      name,
      entry.timeConstant,
    ])
  ),
  ...SOURCE_TIME_CONSTANTS,
});

const CHANNEL_NAMES = Object.keys(CHANNELS);
const ARTICULATOR_NAMES = Object.keys(ARTICULATORS);
/** Channels whose lead stops at the previous sound with its own target. */
const LIMITED_LEADS = new Set(['rounding', 'lipProtrusion', 'velum']);
/** Glottal channels that the fold drive reads before any smoothing. */
const GLOTTAL_CHANNELS = ['voicing', 'aspiration', 'glottalClosure'];
const CONSONANT_SHAPE = new Set([
  'lipArea',
  'tongueArea',
  'tongueLocation',
  'tongueWidth',
]);
/** Manners that close the velum: the pressure behind them needs it. */
const OBSTRUENTS = new Set([
  'plosive',
  'fricative',
  'lateral-fricative',
  'trill',
]);
/** The duration of every part of a token from the rules of durations.js. */
function tokenParts(token, index, context) {
  const features = durationFeatures(context.tokens, index, {
    language: context.language,
  });
  return segmentParts(token, features, context.table, context.duration);
}

function pushConsonant(segments, token, index, context) {
  const parts = tokenParts(token, index, context);
  if (token.affricate) {
    const stop = consonantTarget({
      ...token,
      phoneme: getPhoneme(token.affricate.stop) ?? token.phoneme,
    });
    const fricative = consonantTarget(token);
    stop.tongueLocation = fricative.tongueLocation;
    segments.push({
      token,
      kind: 'consonant',
      target: stop,
      duration: parts[0],
    });
    segments.push({
      token,
      kind: 'consonant',
      target: fricative,
      duration: parts[1],
    });
  } else {
    segments.push({
      token,
      kind: 'consonant',
      target: consonantTarget(token),
      duration: parts[0],
    });
  }
  pushRelease(segments, token, index, context);
}

/**
 * Voice onset time after an oral stop: a short or aspirated release. The
 * constriction keeps its frication gain until the end of the release: the
 * opening areas and the falling mouth pressure time the burst (see
 * src/acoustics/aerodynamics.js). Aspirated stops hold the glottis open
 * (`aspiration` 1) from the closure to the end of the release.
 */
function pushRelease(segments, token, index, context) {
  const manner = token.phoneme.manner;
  if (isBreathyStop(token)) {
    pushBreathyRelease(segments, token, context);
    return;
  }
  if (manner !== 'plosive' || token.voiced || token.affricate) {
    return;
  }
  if (token.phoneme.place === 'glottal') {
    return;
  }
  const aspirated = isAspirated(context.tokens, index, context.language);
  const closure = segments.at(-1);
  const aspiration = aspirated ? 1 : closure.target.aspiration;
  closure.target = { ...closure.target, aspiration };
  segments.push({
    token,
    kind: 'release',
    target: {
      voicing: 0,
      aspiration,
      frication: closure.target.frication,
    },
    duration: (aspirated ? 0.06 : 0.015) / context.duration.speechRate,
  });
}

/** A breathy-voiced plosive or affricate: bʱ dʱ ɖʱ ɡʱ d͡ʒʱ. */
function isBreathyStop(token) {
  return (
    Boolean(token.voiced && token.breathy) &&
    (token.phoneme?.manner === 'plosive' || Boolean(token.affricate))
  );
}

/**
 * Breathy-voiced release of bʱ dʱ ɖʱ ɡʱ dʒʱ (issue 54): voiced, with the
 * breath of a breathy voice and its Rd (`BREATHY_RELEASE`, 80 ms at speech
 * rate 1) and a pitch 1.5 semitones lower that glides into the vowel
 * (`fillPhonation()`). The closure stays that of a plain voiced stop.
 */
function pushBreathyRelease(segments, token, context) {
  segments.push({
    token,
    kind: 'release',
    breathyRelease: true,
    target: { voicing: 1, aspiration: 0, frication: 0 },
    duration: BREATHY_RELEASE.duration / context.duration.speechRate,
  });
}

function pushVowel(segments, token, index, context) {
  segments.push({
    token,
    kind: 'vowel',
    vowel: vowelTarget(token),
    target: vowelChannels(token),
    duration: tokenParts(token, index, context)[0],
  });
}

/**
 * A timed pause or a sound: silence of exactly its length. A timed pause
 * takes the place of the plain pause before it; a sound is a segment of
 * its own.
 */
function pushTimed(segments, token, seconds) {
  const strength = Math.min(3, token.strength ?? 1);
  const previous = segments.at(-1);
  if (token.kind === 'pause' && previous?.kind === 'pause' && !previous.sound) {
    previous.duration = seconds;
    previous.timed = true;
    previous.strength = Math.max(previous.strength, strength);
    previous.target = { voicing: 0, loudness: 0 };
    return;
  }
  segments.push({
    token,
    kind: 'pause',
    strength,
    boundary: boundaryOf(token),
    question: false,
    target: { voicing: 0, loudness: 0 },
    duration: seconds,
    timed: true,
    ...(token.kind === 'sound' ? { sound: token.name } : {}),
  });
}

function pushPause(segments, token, context) {
  const seconds = timedLength(token);
  if (seconds !== null) {
    pushTimed(segments, token, seconds);
    return;
  }
  const strength = Math.min(3, token.strength);
  const duration = scalePause(
    pauseDuration(token) * context.pauseLength,
    strength,
    context.duration.speechRate
  );
  const previous = segments.at(-1);
  if (!previous || previous.kind === 'pause') {
    if (previous) {
      if (!previous.timed) {
        previous.duration = Math.max(previous.duration, duration);
      }
      previous.question ||= token.question;
    }
    return;
  }
  segments.push({
    token,
    kind: 'pause',
    strength,
    boundary: boundaryOf(token),
    question: token.question,
    contour: token.contour,
    target: strength > 0 ? { voicing: 0, loudness: 0 } : {},
    duration,
  });
}

/**
 * Split tokens into timed segments. Durations come from the rules of
 * src/articulation/durations.js with the table of `language` (or
 * `durationTable`).
 * @param {object[]} tokens
 * @param {{rate: number, language?: string, tunes?: string|null, stressLengthening?: number, finalLengthening?: number, pauseLength?: number, durationTable?: object, head?: object}} options
 *   `head` gives the rate exponents and the strengths of the rules;
 *   `tunes` the intonation language (focus and tune tempo, intonation.js),
 *   else `language`.
 */
export function buildSegments(tokens, options) {
  const context = {
    tokens,
    language: options.language,
    table: options.durationTable ?? durationTable(options.language),
    duration: {
      ...options.head,
      speechRate: options.rate ?? 1,
      stressLengthening: options.stressLengthening ?? 1.35,
      finalLengthening: options.finalLengthening ?? 1.4,
    },
    pauseLength: options.pauseLength ?? 1,
  };
  const segments = [
    {
      kind: 'pause',
      strength: 3,
      target: { voicing: 0, loudness: 0 },
      duration: 0.06,
    },
  ];
  tokens.forEach((token, index) => {
    if (token.kind === 'pause' || token.kind === 'sound') {
      pushPause(segments, token, context);
    } else if (token.kind === 'vowel') {
      pushVowel(segments, token, index, context);
    } else if (token.phoneme) {
      pushConsonant(segments, token, index, context);
    }
  });
  applyRates(segments);
  applyIntonationTiming(segments, options.tunes ?? options.language);
  applyEffortDurations(segments);
  if (segments.at(-1).kind === 'pause' && !segments.at(-1).sound) {
    segments.at(-1).strength = 3;
    segments.at(-1).target = { voicing: 0, loudness: 0 };
    if (!segments.at(-1).timed) {
      segments.at(-1).duration = Math.max(segments.at(-1).duration, 0.2);
    }
  } else {
    segments.push({
      kind: 'pause',
      strength: 3,
      target: { voicing: 0, loudness: 0 },
      duration: 0.2,
    });
  }
  let time = 0;
  for (const segment of segments) {
    segment.start = time;
    time += segment.duration;
    segment.end = time;
  }
  return segments;
}

const DEFAULTS = {
  ...NEUTRAL_VOWEL,
  rhotic: 0,
  palatalization: 0,
  lipAmount: 0,
  lipArea: 2,
  tongueAmount: 0,
  tongueArea: 2,
  tongueLocation: 0.8,
  tongueWidth: 0.05,
  velum: 0,
  voicing: 1,
  aspiration: 0,
  glottalClosure: 0,
  frication: 0,
  sibilance: 0,
  trill: 0,
  lateral: 0,
  jaw: teethGap(NEUTRAL_VOWEL, { jawRange: 1 }),
  lipProtrusion: 0,
  larynxHeight: 0,
  tongueRoot: 0,
  loudness: 1,
  f0: 120,
  lungPressure: 800,
  adduction: 0.5,
  foldTension: 1,
  effort: 0,
  tension: 0,
  breath: 0,
  creak: 0,
  falsetto: 0,
  harsh: 0,
};

export { DEFAULTS as CHANNEL_DEFAULTS };

function frameRange(segment, frameRate, frameCount) {
  const first = Math.round(segment.start * frameRate);
  const last = Math.min(frameCount, Math.round(segment.end * frameRate));
  return [first, Math.max(first + 1, last)];
}

/** Step function of a channel from the segment targets (source channels). */
function fillDefaults(channels, segments, frameRate, names = ['loudness']) {
  for (const segment of segments) {
    const [first, last] = frameRange(segment, frameRate, Infinity);
    for (const name of names) {
      const value = segment.target?.[name] ?? DEFAULTS[name];
      channels[name].fill(value, first, last);
    }
  }
}

/**
 * Fill gaps (NaN) by linear interpolation between known frames and hold
 * the first/last known value at the ends.
 */
export function interpolateGaps(values, fallback) {
  const known = [];
  values.forEach((value, index) => {
    if (!Number.isNaN(value)) {
      known.push(index);
    }
  });
  if (known.length === 0) {
    values.fill(fallback);
    return values;
  }
  values.fill(values[known[0]], 0, known[0]);
  values.fill(values[known.at(-1)], known.at(-1));
  for (let k = 0; k < known.length - 1; k++) {
    const from = known[k];
    const to = known[k + 1];
    for (let index = from + 1; index < to; index++) {
      const t = (index - from) / (to - from);
      values[index] = values[from] + (values[to] - values[from]) * t;
    }
  }
  return values;
}

/** The consonant segment a release segment belongs to. */
function closureOf(segments, index) {
  for (let previous = index - 1; previous >= 0; previous--) {
    if (segments[previous].kind === 'consonant') {
      return segments[previous];
    }
  }
  return null;
}

/** Tongue-body target of a consonant or release: own position and resistance. */
function tongueBody(segment, name, levels) {
  const own = resistance(segment.token, levels);
  return { value: own[name], strength: own.resistance };
}

/**
 * A pause holds the lips spread and the velum raised, but it does not stop
 * the anticipation: lips and velum can move during the silence before a
 * sound (`limiting: false` in dynamics.js).
 */
const REST = Object.freeze({ value: 0, limiting: false });

/**
 * Rounding: vowels, rounded and labialized consonants and pauses hold it;
 * other consonants leave it free.
 */
function roundingTarget(segment) {
  if (segment.kind === 'vowel') {
    return {
      value: Math.max(segment.vowel.rounding, segment.target.rounding ?? 0),
      strength: 1,
    };
  }
  if (segment.kind === 'pause') {
    return { ...REST, strength: segment.strength > 0 ? 1 : 0 };
  }
  const target = segment.kind === 'consonant' ? segment.target : {};
  const lipRound = target.lipAmount && target.lipArea > 0.2 ? 1 : 0;
  const value = Math.max(target.rounding ?? 0, lipRound);
  return { value, strength: value > 0 ? 1 : 0 };
}

/**
 * Velum: nasals and nasal vowels open it, obstruents and pauses close it,
 * other sounds leave it free.
 */
function velumTarget(segment) {
  if (segment.kind === 'vowel') {
    const value = segment.target.velum ?? 0;
    return { value, strength: value > 0 ? 1 : 0 };
  }
  if (segment.kind === 'pause') {
    return { ...REST, strength: segment.strength > 0 ? 1 : 0 };
  }
  if (segment.kind === 'release') {
    return { value: 0, strength: 1 };
  }
  const { phoneme } = segment.token;
  if (segment.target.velum > 0) {
    return { value: segment.target.velum, strength: 1 };
  }
  const own = OBSTRUENTS.has(phoneme.manner) && phoneme.place !== 'glottal';
  return { value: 0, strength: own ? 1 : 0 };
}

function tongueTarget(segments, index, name, levels) {
  const segment = segments[index];
  if (segment.kind === 'vowel') {
    return { value: segment.vowel[name], strength: 1 };
  }
  if (segment.kind === 'consonant' || segment.kind === 'release') {
    return tongueBody(segment, name, levels);
  }
  return { value: DEFAULTS[name], strength: 0 };
}

function rhoticTarget(segment) {
  if (segment.kind === 'vowel') {
    return { value: segment.vowel.rhotic ? 1 : 0, strength: 1 };
  }
  const value = segment.kind === 'consonant' ? (segment.target.rhotic ?? 0) : 0;
  return { value, strength: value > 0 ? 1 : 0 };
}

/** Lip and tongue-tip shape: own in consonants, free elsewhere. */
function shapeTarget(segments, index, name) {
  const segment = segments[index];
  const source =
    segment.kind === 'consonant'
      ? segment
      : segment.kind === 'release'
        ? closureOf(segments, index)
        : null;
  return source
    ? { value: source.target[name], strength: 1 }
    : { value: DEFAULTS[name], strength: 0 };
}

/** Consonant channels that raise the jaw (see teethGap()). */
const JAW_CHANNELS = [
  'tongueAmount',
  'tongueLocation',
  'lipAmount',
  'sibilance',
];

/**
 * Jaw: the incisor gap of today's formula (teethGap()) on the targets of
 * the segment. Vowels hold their gap; a consonant pulls the jaw towards the
 * gap it raises it to with the weight of that raise, so that the
 * consonant's middle has the gap of teethGap() between its vowels; pauses
 * and sounds that do not raise the jaw leave it free.
 */
function jawTarget(segments, index, levels, head) {
  const segment = segments[index];
  if (segment.kind === 'pause') {
    return { value: DEFAULTS.jaw, strength: 0 };
  }
  const state = {
    height: segmentTarget(segments, index, 'height', levels).value,
    backness: segmentTarget(segments, index, 'backness', levels).value,
  };
  for (const name of JAW_CHANNELS) {
    state[name] = segmentTarget(segments, index, name, levels).value;
  }
  if (segment.kind === 'vowel') {
    // Effort opens the jaw of vowels (F1 rises; src/articulation/effort.js).
    const effort = segment.effort ?? 0;
    const gap = teethGap(state, head);
    return {
      value:
        effort === 0 ? gap : Math.max(0, gap + effortJaw(effort, state.height)),
      strength: 1,
    };
  }
  const { gap, weight } = consonantJaw(state, head);
  return { value: gap, strength: weight };
}

/** Lip protrusion: LIP_PROTRUSION times the rounding target. */
function protrusionTarget(segment) {
  const target = roundingTarget(segment);
  return { ...target, value: LIP_PROTRUSION * target.value };
}

const TARGETS_OF = {
  height: tongueTarget,
  backness: tongueTarget,
  rounding: (segments, index) => roundingTarget(segments[index]),
  lipProtrusion: (segments, index) => protrusionTarget(segments[index]),
  rhotic: (segments, index) => rhoticTarget(segments[index]),
  velum: (segments, index) => velumTarget(segments[index]),
};

/** Value and strength of one segment for one articulation channel. */
function segmentTarget(segments, index, name, levels, head) {
  if (name === 'jaw') {
    return jawTarget(segments, index, levels, head);
  }
  if (TARGETS_OF[name]) {
    return TARGETS_OF[name](segments, index, name, levels);
  }
  if (CONSONANT_SHAPE.has(name)) {
    return shapeTarget(segments, index, name);
  }
  const segment = segments[index];
  return { value: segment.target?.[name] ?? DEFAULTS[name], strength: 1 };
}

/**
 * Targets of one articulation channel: `{value, start, end, strength}` per
 * segment, times in seconds. Strength 1 is a sound with its own target;
 * below 1 the input mixes the value with the straight line between the
 * neighbouring targets of strength 1 (src/articulation/dynamics.js).
 * @param {object[]} segments Segments of a plan (`plan.segments`).
 * @param {string} name Channel name, a key of `ARTICULATORS`.
 * @param {{resistance?: Record<string, number>, head?: object}} [options]
 *   Values of the levels of `COARTICULATION_RESISTANCE` that replace the
 *   defaults; the head whose `jawRange` scales the `jaw` targets.
 */
export function channelTargets(segments, name, options = {}) {
  const levels = options.resistance
    ? { ...COARTICULATION_RESISTANCE.levels, ...options.resistance }
    : COARTICULATION_RESISTANCE.levels;
  const head =
    name === 'jaw' ? normalizeHeadConfig(options.head ?? DEFAULT_HEAD) : null;
  return segments.map((segment, index) => {
    const target = segmentTarget(segments, index, name, levels, head);
    return {
      value: target.value,
      start: segment.start,
      end: segment.end,
      strength: target.strength,
      limiting: target.limiting,
    };
  });
}

/** Zero-phase critically damped smoothing (forward + backward one-pole). */
export function smoothChannel(values, timeConstant, frameRate) {
  const alpha = 1 - Math.exp(-1 / (timeConstant * frameRate));
  let state = values[0];
  for (let index = 0; index < values.length; index++) {
    state += alpha * (values[index] - state);
    values[index] = state;
  }
  state = values.at(-1);
  for (let index = values.length - 1; index >= 0; index--) {
    state += alpha * (values[index] - state);
    values[index] = state;
  }
  return values;
}

/** Value at `t` of the polyline through `values` placed at `positions`. */
function piecewiseLinear(values, positions, t) {
  if (values.length < 2) {
    return values[0];
  }
  let index = 1;
  while (index < values.length - 1 && t > positions[index]) {
    index++;
  }
  const start = positions[index - 1];
  const span = positions[index] - start;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (t - start) / span)) : 1;
  return values[index - 1] + (values[index] - values[index - 1]) * fraction;
}

/**
 * Declining phrase pitch with stress accents, tones and final contours.
 * Phrases without tones: a piecewise linear curve through the pitch points
 * of every nucleus. Phrases with tones (issue 49): the voice approaches
 * the targets of one syllable after the other (`approachTargets()` of
 * tone-model.js, once per phrase from rest); the interval of a syllable
 * lasts from the end of the nucleus before it (the first: the start of its
 * own nucleus) to the end of its nucleus, so a tone starts where the one
 * before it ended. Pauses between phrases are interpolated.
 * Returns the tone shape and the frames of tonal phrases (`tonal`, 1
 * inside): the shape is, per frame, the ratio of the curve to the straight
 * line between the first and the last point of its nucleus; it is 1
 * outside nuclei with three or more points.
 * With the `height` channel and `head.intrinsicPitch` (semitones between the
 * closest and the most open vowel), close vowels get a higher pitch
 * (Whalen & Levitt 1995). `pitch.language` picks the tunes of
 * intonation.js and `pitch.effort` (the effort channel) raises the pitch.
 */
function fillPitch(values, segments, head, frameRate, height, pitch = {}) {
  const { language, effort } = pitch;
  values.fill(Number.NaN);
  const shape = new Float32Array(values.length).fill(1);
  const tonal = new Uint8Array(values.length);
  const phrases = new Map();
  for (const target of pitchTargets(segments, head, language)) {
    if (target.intervals) {
      const list = phrases.get(target.phrase) ?? [];
      list.push(target);
      phrases.set(target.phrase, list);
      continue;
    }
    const { segment, from, to, points } = target;
    const [first, last] = frameRange(segment, frameRate, values.length);
    const positions = pointPositions(points.length);
    for (let frame = first; frame < last; frame++) {
      const t = last - first > 1 ? (frame - first) / (last - first - 1) : 0;
      values[frame] = piecewiseLinear(points, positions, t);
      if (points.length > 2) {
        shape[frame] = values[frame] / (from + (to - from) * t);
      }
    }
  }
  for (const targets of phrases.values()) {
    fillTonalPhrase(values, tonal, targets, head, frameRate);
  }
  interpolateGaps(values, head.pitch);
  const intrinsic = head.intrinsicPitch ?? 0;
  if (intrinsic !== 0 && height) {
    for (let frame = 0; frame < values.length; frame++) {
      values[frame] *= 2 ** ((intrinsic * (height[frame] - 0.5)) / 12);
    }
  }
  if (effort) {
    addEffortPitch(values, effort, head);
  }
  return { shape, tonal };
}

/**
 * Raise the pitch by the effort rule (`pitch` of `EFFORT_RULES`: +5 Hz per
 * dB of effort re the speaker's pitch, -4 to +12 semitones).
 */
function addEffortPitch(values, effort, head) {
  for (let frame = 0; frame < values.length; frame++) {
    if (effort[frame] !== 0) {
      const shift = EFFORT_RULES.pitch.value(effort[frame], head);
      values[frame] *= 2 ** (shift / 12);
    }
  }
}

/**
 * Pitch of one tonal phrase from the targets of its syllables: every
 * syllable gets whole frames and its targets are scaled to them.
 */
function fillTonalPhrase(values, tonal, targets, head, frameRate) {
  const first = Math.round(targets[0].start * frameRate);
  if (first >= values.length) {
    return;
  }
  const intervals = [];
  let frame = first;
  for (const target of targets) {
    const end = Math.max(frame + 1, Math.round(target.end * frameRate));
    const seconds = (end - frame) / frameRate;
    const total = target.intervals.reduce(
      (sum, item) => sum + item.duration,
      0
    );
    for (const interval of target.intervals) {
      const share = total > 0 ? interval.duration / total : 1;
      intervals.push({ ...interval, duration: seconds * share });
    }
    frame = end;
  }
  const { values: steps } = approachToneTargets(intervals, null, frameRate);
  const count = Math.min(steps.length, values.length - first);
  for (let index = 0; index < count; index++) {
    values[first + index] = head.pitch * 2 ** (steps[index] / 12);
    tonal[first + index] = 1;
  }
}

/**
 * Larynx rising with the pitch: `head.larynxPitch` cm per octave of f0
 * above the speaker's pitch (lower below it).
 */
function addLarynxPitch(larynxHeight, f0, head) {
  const coupling = head.larynxPitch ?? 0;
  if (coupling === 0) {
    return;
  }
  for (let frame = 0; frame < larynxHeight.length; frame++) {
    larynxHeight[frame] += coupling * Math.log2(f0[frame] / head.pitch);
  }
}

/**
 * Smooth the pitch movement between syllables but keep the shape of contour
 * tones inside their nucleus. The f0 time constant (30 ms, zero phase) gives
 * steps of about 100 ms from 10 % to 90 %; applied to the whole curve it
 * would leave a 170 ms third tone `ma˨˩˦` a dip of 3 Hz (103.5 Hz at the
 * vowel start, 100.6 Hz at 30 %), while the plan dips by 13 Hz (105.4 Hz
 * to 92.5 Hz): `node experiments/issue-42-vowel-f0.mjs`. The pitch is divided by
 * the tone shape, smoothed and multiplied back. The frames of tonal
 * phrases (`tonal`) keep the curve of the tone model, which is already
 * smooth: it is continuous with its first and second derivative.
 */
function smoothPitch(values, { shape, tonal }, timeConstant, frameRate) {
  const raw = Float32Array.from(values);
  for (let frame = 0; frame < values.length; frame++) {
    values[frame] /= shape[frame];
  }
  smoothChannel(values, timeConstant, frameRate);
  for (let frame = 0; frame < values.length; frame++) {
    values[frame] = tonal[frame] ? raw[frame] : values[frame] * shape[frame];
  }
  return values;
}

/** Louder exclamations, quieter parentheticals. */
function applyRegisterGain(values, segments, frameRate, language) {
  for (const { segment, gain } of registerGains(segments, language)) {
    const [first, last] = frameRange(segment, frameRate, values.length);
    for (let frame = first; frame < last; frame++) {
      values[frame] *= gain;
    }
  }
}

/** Slow periodic pitch modulation (vibrato / natural jitter). */
function addVibrato(values, head, frameRate) {
  const depth = head.vibrato * 0.004;
  for (let frame = 0; frame < values.length; frame++) {
    const time = frame / frameRate;
    values[frame] *=
      1 + depth * Math.sin(2 * Math.PI * head.vibratoRate * time);
  }
}

/**
 * Lung pressure and adduction of the fold source from the unsmoothed
 * loudness, voicing, aspiration and glottal closure. The sound level rises
 * about 9 dB per doubling of the lung pressure (Titze and Sundberg 1992),
 * so the pressure goes with the amplitude to the power 2/3. The folds close
 * with voicing and tenseness and open with breathiness, open for aspiration
 * and press together for a glottal stop. Vocal effort raises the pressure
 * by `2^(E/9)` (`lungPressure` of `EFFORT_RULES`).
 */
function fillFoldDrive(channels, steps, head) {
  const { loudness, voicing, aspiration, glottalClosure, effort } = steps;
  const { phonationTension, breath } = steps;
  const tense = 0.6 * (head.tenseness - 0.6);
  const breathy = 0.3 * (head.breathiness - 0.2);
  const modal = Math.min(1, Math.max(0.25, 0.5 + tense - breathy));
  for (let frame = 0; frame < loudness.length; frame++) {
    channels.lungPressure[frame] =
      head.lungPressure * Math.max(0, loudness[frame]) ** (2 / 3);
    if (effort[frame] !== 0) {
      channels.lungPressure[frame] *= EFFORT_RULES.lungPressure.value(
        effort[frame]
      );
    }
    const rest = phonationTension
      ? phonationAdduction(modal, phonationTension[frame], breath[frame])
      : modal;
    let adduction = Math.max(0, voicing[frame]) * rest;
    const open = Math.min(1, Math.max(0, aspiration[frame]));
    adduction += (Math.min(adduction, 0.2) - adduction) * open;
    const closed = Math.min(1, Math.max(0, glottalClosure[frame]));
    channels.adduction[frame] = adduction + (1 - adduction) * closed;
  }
}

/**
 * Adduction of the fold source under a phonation (issue 54): the tension
 * of the phonation moves it as the head tenseness does (0.6 per unit),
 * its breath as the head breathiness (-0.3 per unit), down to
 * `FOLD_PHONATION.minAdduction`: a breathy voice holds the folds further
 * apart, a pressed one presses them together, falsetto (lax, a little
 * breath) leaves them barely touching.
 */
function phonationAdduction(modal, tension, breath) {
  if (tension === 0 && breath === 0) {
    return modal;
  }
  return Math.min(
    1,
    Math.max(
      FOLD_PHONATION.minAdduction,
      modal + FOLD_PHONATION.tension * tension - FOLD_PHONATION.breath * breath
    )
  );
}

/**
 * How the phonation channels drive the fold source (issue 54): the
 * adduction per unit of phonation tension and breath and its lower
 * limit, and the pitch the folds are tuned for, `f0 * 2^(falsetto -
 * creak)` (thin stiff folds an octave up, thick slack ones an octave
 * down, not below `creakFloor` Hz). Creak also lowers the lung pressure
 * of the folds by `creakPressure` (src/acoustics/folds.js).
 */
export const FOLD_PHONATION = Object.freeze({
  tension: 0.6,
  breath: 0.3,
  minAdduction: 0.15,
  creakFloor: 25,
});

/**
 * Fold tension for the final pitch and lung pressure. It follows the f0
 * channel, which is already smoothed with the same 0.03 s. Under vocal
 * effort the tension is set for the pitch less the rise the folds give on
 * their own at the raised pressure (`foldPitchFactor()`, issue 52).
 */
function fillFoldTension(channels, head) {
  const { f0, lungPressure, foldTension, effort, creak, falsetto } = channels;
  for (let frame = 0; frame < f0.length; frame++) {
    let pitch = f0[frame] * foldPitchFactor(effort[frame]);
    if (creak[frame] !== 0 || falsetto[frame] !== 0) {
      const floor = Math.min(pitch, FOLD_PHONATION.creakFloor);
      pitch = Math.max(floor, pitch * 2 ** (falsetto[frame] - creak[frame]));
    }
    foldTension[frame] = tensionForPitch(pitch, lungPressure[frame], head);
  }
}

/** The phonation channels of a segment (./phonation.js). */
function segmentPhonation(segment, head) {
  if (segment.breathyRelease) {
    return breathyReleaseChannels(head);
  }
  const { token } = segment;
  // A breathy stop is breathy in its release, not in its closure.
  return phonationChannels(
    token.mode,
    isBreathyStop(token) ? null : token,
    head
  );
}

/**
 * Fill the phonation channels (`breath`, `creak`, `falsetto`, `harsh`)
 * as steps from the segments and add the Rd change of each phonation to
 * the `tension` channel (issue 54). Returns the tension of the phonation
 * alone (the fold drive reads it), or null when every segment is modal.
 */
function fillPhonation(channels, segments, head, frameRate) {
  let phonationTension = null;
  const frameCount = channels.tension.length;
  const cache = new Map();
  for (const segment of segments) {
    if (!segment.token) {
      continue;
    }
    const key = segment.breathyRelease ? 'release' : segment.token;
    if (!cache.has(key)) {
      cache.set(key, segmentPhonation(segment, head));
    }
    const values = cache.get(key);
    if (isModal(values)) {
      continue;
    }
    phonationTension ??= new Float32Array(frameCount);
    const [first, last] = frameRange(segment, frameRate, frameCount);
    for (let frame = first; frame < last; frame++) {
      channels.tension[frame] += values.tension;
      phonationTension[frame] = values.tension;
    }
    for (const name of PHONATION_CHANNELS) {
      channels[name].fill(values[name], first, last);
    }
  }
  return phonationTension;
}

/**
 * Lower the pitch of breathy-voiced releases by `BREATHY_RELEASE.pitch`
 * semitones; the smoothing of f0 glides it into the vowel.
 */
function lowerBreathyReleases(f0, segments, frameRate) {
  const factor = 2 ** (BREATHY_RELEASE.pitch / 12);
  for (const segment of segments) {
    if (segment.breathyRelease) {
      const [first, last] = frameRange(segment, frameRate, f0.length);
      for (let frame = first; frame < last; frame++) {
        f0[frame] *= factor;
      }
    }
  }
}

/** Pauses that end a phrase with phrase-final creak: `.` and `‖`. */
const CREAK_PAUSES = new Set(['.', '‖']);

/**
 * Phrase-final creak (`head.finalCreak`, issue 54): over the last vowel
 * before `.` or `‖` and what follows it up to the pause, the creak of
 * `finalCreakAmount()` at the final (smoothed) f0 where it is larger.
 */
function fillFinalCreak(creak, f0, segments, head, frameRate) {
  if (!(head.finalCreak > 0)) {
    return;
  }
  segments.forEach((segment, index) => {
    if (segment.kind !== 'pause' || !CREAK_PAUSES.has(segment.token?.symbol)) {
      return;
    }
    let vowel = index - 1;
    while (vowel >= 0 && segments[vowel].kind !== 'vowel') {
      if (segments[vowel].kind === 'pause') {
        return;
      }
      vowel--;
    }
    if (vowel < 0) {
      return;
    }
    const first = Math.round(segments[vowel].start * frameRate);
    const last = Math.min(f0.length, Math.round(segment.start * frameRate));
    for (let frame = first; frame < last; frame++) {
      const amount = finalCreakAmount(f0[frame], head.pitch, head.finalCreak);
      creak[frame] = Math.max(creak[frame], amount);
    }
  });
}

/**
 * Set `segment.effort` (dB) of the segments whose middle lies where the
 * effort channel is not 0; the jaw target of a vowel opens with it.
 */
function markSegmentEffort(segments, effort, frameRate) {
  for (const segment of segments) {
    const middle = Math.round(((segment.start + segment.end) / 2) * frameRate);
    const value = effort[Math.min(effort.length - 1, Math.max(0, middle))];
    if (value !== 0) {
      segment.effort = value;
    }
  }
}

export { fillDefaults, fillPitch };
export { modeAt } from './modes.js';

/**
 * Rescale the segments of each token to the measured durations: a token
 * that makes several segments (closure and release, affricates) keeps
 * their proportions. Tokens without a segment (a pause merged into the
 * previous one) and `null` entries are skipped.
 */
function applyDurations(segments, tokens, durations) {
  const byToken = new Map();
  for (const segment of segments) {
    if (segment.token) {
      const list = byToken.get(segment.token) ?? [];
      list.push(segment);
      byToken.set(segment.token, list);
    }
  }
  tokens.forEach((token, index) => {
    const duration = durations[index];
    const list = byToken.get(token);
    if (!list || duration === null || duration === undefined) {
      return;
    }
    const total = list.reduce((sum, segment) => sum + segment.duration, 0);
    for (const segment of list) {
      segment.duration =
        total > 0
          ? (Math.max(0, duration) * segment.duration) / total
          : Math.max(0, duration) / list.length;
    }
  });
  let time = 0;
  for (const segment of segments) {
    segment.start = time;
    time += segment.duration;
    segment.end = time;
  }
}

/** Head keys of the leads of the channels that have one in the head. */
const HEAD_LEADS = Object.freeze({
  rounding: 'roundingLead',
  lipProtrusion: 'roundingLead',
  velum: 'velumLead',
});

/** Head key of the speed of each channel: speedJaw. */
const SPEED_KEYS = Object.freeze(
  Object.fromEntries(
    Object.keys(ARTICULATORS).map((name) => [name, suffixKey('speed', name)])
  )
);

/**
 * Time constant and lead of every articulator, with the overrides: the
 * head's articulationSpeed and speed<Channel> divide both,
 * coarticulation multiplies the lead, and roundingLead and velumLead set
 * the leads of rounding, lipProtrusion and velum.
 */
function articulatorsFor(head, overrides = {}) {
  return Object.fromEntries(
    ARTICULATOR_NAMES.map((name) => {
      const lead = head[HEAD_LEADS[name]];
      const entry = {
        ...ARTICULATORS[name],
        ...(lead === undefined ? {} : { lead }),
        ...overrides[name],
      };
      const speed = head.articulationSpeed * (head[SPEED_KEYS[name]] ?? 1);
      return [
        name,
        {
          timeConstant: entry.timeConstant / speed,
          lead: (entry.lead * head.coarticulation) / speed,
        },
      ];
    })
  );
}

/**
 * The head of a plan with the accent's articulation offsets and prosody
 * factors, and its duration table: `options.durationTable`, else the
 * table of the accent's `prosody.tunes`.
 */
function accentedHead(options) {
  const head = accentHead(
    normalizeHeadConfig(options.head ?? DEFAULT_HEAD),
    options.accent
  );
  const tunes = options.accent?.prosody?.tunes;
  const table =
    options.durationTable ?? (tunes ? durationTable(tunes) : undefined);
  return { head, table, tunes: tunes ?? options.language };
}

/**
 * Smooth the source channels with their SOURCE_TIME_CONSTANTS (f0 along
 * its pitch shape), add the vibrato, then the phrase-final creak (which
 * follows the smoothed f0) and smooth the phonation channels.
 */
function smoothSource(channels, pitchShape, segments, head, frameRate) {
  const speed = head.articulationSpeed;
  for (const name of [
    'loudness',
    'f0',
    'lungPressure',
    'adduction',
    'effort',
    'tension',
  ]) {
    const timeConstant = SOURCE_TIME_CONSTANTS[name] / speed;
    if (name === 'f0') {
      smoothPitch(channels.f0, pitchShape, timeConstant, frameRate);
    } else {
      smoothChannel(channels[name], timeConstant, frameRate);
    }
  }
  addVibrato(channels.f0, head, frameRate);
  fillFinalCreak(channels.creak, channels.f0, segments, head, frameRate);
  for (const name of PHONATION_CHANNELS) {
    smoothChannel(
      channels[name],
      SOURCE_TIME_CONSTANTS[name] / speed,
      frameRate
    );
  }
}

/**
 * Plan an utterance from IPA.
 * @param {string|object[]} ipa IPA string or parsed tokens.
 * @param {{head?: object, language?: string, frameRate?: number, durations?: (number|null)[], durationTable?: object, accent?: {prosody?: {tunes?: string|null, range?: number, rate?: number, stressLengthening?: number}, articulation?: Record<string, number>}, articulators?: Record<string, {timeConstant?: number, lead?: number}>, resistance?: Record<string, number>, modes?: {from: number, to: number, mode: object}[]}} [options]
 *   `durations`: seconds per token (measured durations), which win over
 *   the rules; `durationTable`: an entry of `DURATION_TABLES` that overrides
 *   the table of `language`; `accent` (see accentSettings of
 *   src/accent/index.js): its articulation offsets and prosody factors
 *   change the head and `prosody.tunes` picks the duration table of that
 *   language; `articulators`
 *   and `resistance` override `ARTICULATORS` and the levels of
 *   `COARTICULATION_RESISTANCE`; `modes`: mode spans in IPA word indexes
 *   (`textToIpa(...).modes`), else the ExtIPA/VoQS marks of the IPA.
 * @returns the plan; `modes` are its mode spans in seconds (sorted, not
 *   overlapping, from 0 to `duration`) and `sounds` the `{name, start, end}`
 *   of its sounds. Every token gets its `mode` (see ./modes.js).
 */
export function planUtterance(ipa, options = {}) {
  const parsed = typeof ipa === 'string' ? parseIpa(ipa) : null;
  const tokens = parsed ? parsed.tokens : ipa;
  assignTokenModes(tokens, options.modes ?? parsed?.modes ?? []);
  const { head, table, tunes } = accentedHead(options);
  const frameRate = options.frameRate ?? CONTROL_RATE;
  const segments = buildSegments(tokens, {
    rate: head.speechRate,
    language: options.language,
    stressLengthening: head.stressLengthening,
    finalLengthening: head.finalLengthening,
    pauseLength: head.pauseLength,
    durationTable: table,
    head,
    tunes,
  });
  if (options.durations) {
    applyDurations(segments, tokens, options.durations);
  }
  const duration = segments.at(-1).end;
  const frameCount = Math.ceil(duration * frameRate) + 1;
  const modes = planModes(segments);
  const effort = fillEffort(
    new Float32Array(frameCount),
    modes,
    frameRate,
    segments
  );
  markSegmentEffort(segments, effort, frameRate);
  const channels = {};
  const articulators = articulatorsFor(head, options.articulators);
  for (const name of ARTICULATOR_NAMES) {
    const targets = channelTargets(segments, name, { ...options, head });
    const { timeConstant, lead } = articulators[name];
    channels[name] = approachTargets(
      targets,
      timeConstant,
      frameRate,
      DYNAMICS_ORDER,
      {
        lead,
        limited: LIMITED_LEADS.has(name),
        frameCount,
        fallback: DEFAULTS[name],
      }
    );
  }
  for (const name of Object.keys(SOURCE_TIME_CONSTANTS)) {
    channels[name] = new Float32Array(frameCount);
  }
  fillDefaults(channels, segments, frameRate);
  applyRegisterGain(channels.loudness, segments, frameRate, tunes);
  applyModeGains(channels.loudness, modes, frameRate);
  channels.effort.set(effort);
  for (let frame = 0; frame < frameCount; frame++) {
    channels.tension[frame] = TENSION_PER_DB * effort[frame];
  }
  const phonationTension = fillPhonation(channels, segments, head, frameRate);
  const pitchShape = fillPitch(
    channels.f0,
    segments,
    head,
    frameRate,
    channels.height,
    { language: tunes, effort }
  );
  lowerBreathyReleases(channels.f0, segments, frameRate);
  const steps = {
    loudness: channels.loudness,
    effort,
    phonationTension,
    breath: channels.breath,
  };
  for (const name of GLOTTAL_CHANNELS) {
    steps[name] = new Float32Array(frameCount);
  }
  fillDefaults(steps, segments, frameRate, GLOTTAL_CHANNELS);
  fillFoldDrive(channels, steps, head);
  smoothSource(channels, pitchShape, segments, head, frameRate);
  addLarynxPitch(channels.larynxHeight, channels.f0, head);
  fillFoldTension(channels, head);
  const ordered = Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, channels[name]])
  );
  return {
    tokens,
    segments,
    head,
    frameRate,
    frameCount,
    duration,
    channels: ordered,
    modes,
    sounds: planSounds(segments),
  };
}
