/**
 * Utterance planning: IPA tokens -> timed segments -> smooth articulator
 * trajectories sampled at a fixed control rate.
 *
 * Targets are step functions per channel; transitions come from zero-phase
 * critically damped smoothing (a first-order low-pass run forward and
 * backward), with one time constant per articulator: lips and tongue tip
 * are fast, tongue body and velum are slower. Vowel channels are linearly
 * interpolated through consonants, which gives natural coarticulation.
 */

import { getPhoneme } from '../ipa/inventory.js';
import { parseIpa } from '../ipa/parse.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import {
  NEUTRAL_VOWEL,
  consonantTarget,
  vowelChannels,
  vowelTarget,
} from './phones.js';

export const CONTROL_RATE = 200;

/** Articulator channels and their smoothing time constants in seconds. */
export const CHANNELS = Object.freeze({
  height: 0.03,
  backness: 0.03,
  rounding: 0.02,
  rhotic: 0.025,
  palatalization: 0.02,
  lipAmount: 0.01,
  lipArea: 0.006,
  tongueAmount: 0.012,
  tongueArea: 0.006,
  tongueLocation: 0.012,
  tongueWidth: 0.012,
  velum: 0.022,
  voicing: 0.008,
  aspiration: 0.01,
  glottalClosure: 0.006,
  frication: 0.006,
  sibilance: 0.01,
  trill: 0.01,
  lateral: 0.015,
  loudness: 0.018,
  f0: 0.03,
});

const CHANNEL_NAMES = Object.keys(CHANNELS);
const VOWEL_CHANNELS = ['height', 'backness', 'rounding', 'rhotic', 'f0'];
const CONSONANT_SHAPE = [
  'lipArea',
  'tongueArea',
  'tongueLocation',
  'tongueWidth',
];
const REDUCED_VOWELS = new Set(['ə', 'ɐ', 'ɪ', 'ʊ', 'ɨ', 'ɚ']);
const OFFGLIDES = new Set(['ɪ', 'ʊ', 'i', 'u', 'ə', 'ɚ', 'y', 'ɯ']);
const PAUSE_DURATIONS = [0.012, 0.09, 0.2, 0.36];

function vowelDuration(token, context) {
  let duration = 0.105;
  if (token.stress === 1) {
    duration *= 1.35;
  } else if (token.stress === 2) {
    duration *= 1.15;
  } else if (REDUCED_VOWELS.has(token.base) && !context.tonal) {
    duration *= 0.75;
  }
  if (token.long) {
    duration *= 1.7;
  }
  if (context.offglide) {
    duration *= 0.6;
  }
  if (context.tonal) {
    duration *= 1.15;
  }
  return context.phraseFinal ? duration * 1.4 : duration;
}

function isPhraseEnd(tokens, index) {
  for (let next = index + 1; next < tokens.length; next++) {
    const token = tokens[next];
    if (token.kind === 'pause' && token.strength >= 2) {
      return true;
    }
    if (token.kind === 'vowel' || token.syllabic) {
      return false;
    }
  }
  return true;
}

function nextVowel(tokens, index) {
  for (let next = index + 1; next < tokens.length; next++) {
    if (tokens[next].kind === 'pause') {
      return null;
    }
    if (tokens[next].kind === 'vowel') {
      return tokens[next];
    }
  }
  return null;
}

/** English voiceless stops are aspirated before stressed vowels. */
function isAspirated(tokens, index, language) {
  const token = tokens[index];
  if (token.aspirated) {
    return true;
  }
  if (language !== 'en' || token.voiced || token.phoneme.manner !== 'plosive') {
    return false;
  }
  const previous = tokens[index - 1];
  const wordInitial = !previous || previous.word !== token.word;
  const vowel = nextVowel(tokens, index);
  const adjacent = tokens[index + 1]?.kind === 'vowel';
  return Boolean(vowel && adjacent && (wordInitial || vowel.stress === 1));
}

function pushConsonant(segments, token, index, context) {
  const phraseFinal = isPhraseEnd(context.tokens, index);
  const scale = context.rate * (phraseFinal ? 1.2 : 1) * (token.long ? 1.8 : 1);
  if (token.affricate) {
    const stop = consonantTarget({
      ...token,
      phoneme: getPhoneme(token.affricate.stop) ?? token.phoneme,
    });
    const fricative = consonantTarget(token);
    stop.tongueLocation = fricative.tongueLocation;
    segments.push({ token, kind: 'consonant', target: stop, duration: 0.05 });
    segments.push({
      token,
      kind: 'consonant',
      target: fricative,
      duration: 0.07 * scale,
    });
  } else {
    const target = consonantTarget(token);
    const devoiced = target.voicing ? 1 : 1.15;
    segments.push({
      token,
      kind: 'consonant',
      target,
      duration: (target.duration / 1000) * scale * devoiced,
    });
  }
  pushRelease(segments, token, index, context);
}

/** Voice onset time after an oral stop: a short or aspirated release. */
function pushRelease(segments, token, index, context) {
  const manner = token.phoneme.manner;
  if (manner !== 'plosive' || token.voiced || token.affricate) {
    return;
  }
  if (token.phoneme.place === 'glottal') {
    return;
  }
  const aspirated = isAspirated(context.tokens, index, context.language);
  segments.push({
    token,
    kind: 'release',
    target: {
      voicing: 0,
      aspiration: aspirated ? 1 : 0.35,
      frication: 0,
    },
    duration: (aspirated ? 0.06 : 0.015) * context.rate,
  });
}

function pushVowel(segments, token, index, context) {
  const previous = context.tokens[index - 1];
  const offglide =
    previous?.kind === 'vowel' &&
    previous.word === token.word &&
    !token.stress &&
    !token.long &&
    !token.tone &&
    OFFGLIDES.has(token.base);
  const duration = vowelDuration(token, {
    offglide,
    tonal: context.tonal,
    phraseFinal: isPhraseEnd(context.tokens, index),
  });
  segments.push({
    token,
    kind: 'vowel',
    vowel: vowelTarget(token),
    target: vowelChannels(token),
    duration: duration * context.rate,
  });
}

function pushPause(segments, token) {
  const strength = Math.min(3, token.strength);
  const duration = PAUSE_DURATIONS[strength];
  if (segments.length === 0 || segments.at(-1).kind === 'pause') {
    if (segments.length) {
      segments.at(-1).duration = Math.max(segments.at(-1).duration, duration);
      segments.at(-1).question ||= token.question;
    }
    return;
  }
  segments.push({
    token,
    kind: 'pause',
    strength,
    question: token.question,
    target: strength > 0 ? { voicing: 0, loudness: 0 } : {},
    duration,
  });
}

/**
 * Split tokens into timed segments.
 * @param {object[]} tokens
 * @param {{rate: number, language?: string}} options
 */
export function buildSegments(tokens, options) {
  const context = {
    tokens,
    rate: 1 / options.rate,
    language: options.language,
    tonal: tokens.some((token) => token.tone),
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
    if (token.kind === 'pause') {
      pushPause(segments, token);
    } else if (token.kind === 'vowel') {
      pushVowel(segments, token, index, context);
    } else if (token.phoneme) {
      pushConsonant(segments, token, index, context);
    }
  });
  if (segments.at(-1).kind === 'pause') {
    segments.at(-1).strength = 3;
    segments.at(-1).target = { voicing: 0, loudness: 0 };
    segments.at(-1).duration = Math.max(segments.at(-1).duration, 0.2);
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
  loudness: 1,
  f0: 120,
};

export { DEFAULTS as CHANNEL_DEFAULTS };

function frameRange(segment, frameRate, frameCount) {
  const first = Math.round(segment.start * frameRate);
  const last = Math.min(frameCount, Math.round(segment.end * frameRate));
  return [first, Math.max(first + 1, last)];
}

function fillDefaults(channels, segments, frameRate) {
  for (const segment of segments) {
    const [first, last] = frameRange(segment, frameRate, Infinity);
    for (const name of CHANNEL_NAMES) {
      if (VOWEL_CHANNELS.includes(name) || CONSONANT_SHAPE.includes(name)) {
        continue;
      }
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

/** Fill gaps with the value of the nearest known frame. */
function nearestGaps(values, fallback) {
  let previous = -1;
  const next = new Int32Array(values.length).fill(-1);
  for (let index = values.length - 1, seen = -1; index >= 0; index--) {
    if (!Number.isNaN(values[index])) {
      seen = index;
    }
    next[index] = seen;
  }
  for (let index = 0; index < values.length; index++) {
    if (!Number.isNaN(values[index])) {
      previous = index;
      continue;
    }
    const after = next[index];
    const useNext =
      after >= 0 && (previous < 0 || after - index < index - previous);
    const source = useNext ? after : previous;
    values[index] = source >= 0 ? values[source] : fallback;
  }
  return values;
}

function fillArticulation(channels, segments, frameRate) {
  for (const name of [...VOWEL_CHANNELS, ...CONSONANT_SHAPE]) {
    channels[name].fill(Number.NaN);
  }
  for (const segment of segments) {
    const [first, last] = frameRange(segment, frameRate, Infinity);
    if (segment.kind === 'vowel') {
      channels.height.fill(segment.vowel.height, first, last);
      channels.backness.fill(segment.vowel.backness, first, last);
      channels.rounding.fill(
        Math.max(segment.vowel.rounding, segment.target.rounding),
        first,
        last
      );
      channels.rhotic.fill(segment.vowel.rhotic ? 1 : 0, first, last);
    } else if (segment.kind === 'consonant') {
      for (const name of CONSONANT_SHAPE) {
        channels[name].fill(segment.target[name], first, last);
      }
    }
  }
  for (const name of ['height', 'backness', 'rounding', 'rhotic']) {
    interpolateGaps(channels[name], DEFAULTS[name]);
  }
  for (const name of CONSONANT_SHAPE) {
    nearestGaps(channels[name], DEFAULTS[name]);
  }
  for (const segment of segments) {
    if (segment.kind === 'consonant') {
      applyConsonantOverlay(channels, segment, frameRate);
    }
  }
}

/** Labialized and rhotic consonants raise rounding / rhoticity locally. */
function applyConsonantOverlay(channels, segment, frameRate) {
  const [first, last] = frameRange(segment, frameRate, Infinity);
  const { rounding = 0, rhotic = 0 } = segment.target;
  const lipRound = segment.target.lipAmount && segment.target.lipArea > 0.2;
  for (let index = first; index < last; index++) {
    channels.rounding[index] = Math.max(
      channels.rounding[index],
      rounding,
      lipRound ? 1 : 0
    );
    channels.rhotic[index] = Math.max(channels.rhotic[index], rhotic);
  }
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

const semitones = (base, steps) => base * 2 ** (steps / 12);

/** Pitch target (Hz) at the start and end of a voiced syllable nucleus. */
function syllablePitch(segment, context) {
  const { head, phraseStart, phraseEnd, question } = context;
  const progress =
    (segment.start - phraseStart) / Math.max(0.2, phraseEnd - phraseStart);
  const base = semitones(head.pitch, -2 * progress);
  const tone = segment.token.tone;
  if (tone) {
    const scale = 1.2 + 0.35 * head.pitchRange;
    return [
      semitones(base, (tone[0] - 3) * scale),
      semitones(base, (tone.at(-1) - 3) * scale),
    ];
  }
  const accent = segment.token.stress === 1 ? head.pitchRange : 0;
  const accented = semitones(base, accent);
  if (!context.last) {
    return [accented, semitones(base, accent * 0.6)];
  }
  if (question) {
    return [accented, semitones(base, 1.5 * head.pitchRange + 1)];
  }
  return [accented, semitones(base, -0.8 * head.pitchRange - 1)];
}

function phraseBounds(segments) {
  const phrases = [];
  let current = [];
  for (const segment of segments) {
    if (segment.kind === 'pause' && segment.strength >= 2) {
      if (current.length) {
        phrases.push({ nuclei: current, question: segment.question });
      }
      current = [];
    } else if (segment.kind === 'vowel' || segment.token?.syllabic) {
      current.push(segment);
    }
  }
  if (current.length) {
    phrases.push({ nuclei: current, question: false });
  }
  return phrases;
}

/** Declining phrase pitch with stress accents, tones and final contours. */
function fillPitch(values, segments, head, frameRate) {
  values.fill(Number.NaN);
  for (const phrase of phraseBounds(segments)) {
    const { nuclei } = phrase;
    nuclei.forEach((segment, index) => {
      const [first, last] = frameRange(segment, frameRate, values.length);
      const [from, to] = syllablePitch(segment, {
        head,
        phraseStart: nuclei[0].start,
        phraseEnd: nuclei.at(-1).end,
        question: phrase.question,
        last: index === nuclei.length - 1,
      });
      for (let frame = first; frame < last; frame++) {
        const t = last - first > 1 ? (frame - first) / (last - first - 1) : 0;
        values[frame] = from + (to - from) * t;
      }
    });
  }
  return interpolateGaps(values, head.pitch);
}

/** Slow periodic pitch modulation (vibrato / natural jitter). */
function addVibrato(values, head, frameRate) {
  const depth = head.vibrato * 0.004;
  for (let frame = 0; frame < values.length; frame++) {
    const time = frame / frameRate;
    values[frame] *= 1 + depth * Math.sin(2 * Math.PI * 5.2 * time);
  }
}

export { fillArticulation, fillDefaults, fillPitch };

/**
 * Plan an utterance from IPA.
 * @param {string|object[]} ipa IPA string or parsed tokens.
 * @param {{head?: object, language?: string, frameRate?: number}} [options]
 */
export function planUtterance(ipa, options = {}) {
  const tokens = typeof ipa === 'string' ? parseIpa(ipa).tokens : ipa;
  const head = normalizeHeadConfig(options.head ?? DEFAULT_HEAD);
  const frameRate = options.frameRate ?? CONTROL_RATE;
  const segments = buildSegments(tokens, {
    rate: head.speechRate,
    language: options.language,
  });
  const duration = segments.at(-1).end;
  const frameCount = Math.ceil(duration * frameRate) + 1;
  const channels = Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, new Float32Array(frameCount)])
  );
  fillDefaults(channels, segments, frameRate);
  fillArticulation(channels, segments, frameRate);
  fillPitch(channels.f0, segments, head, frameRate);
  for (const name of CHANNEL_NAMES) {
    smoothChannel(channels[name], CHANNELS[name], frameRate);
  }
  addVibrato(channels.f0, head, frameRate);
  return { tokens, segments, head, frameRate, frameCount, duration, channels };
}
