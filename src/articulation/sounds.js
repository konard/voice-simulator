/**
 * Paralinguistic sounds (issue 56): breaths, laughter, sighs, coughs,
 * hesitations and clicks. A sound (`[laugh]`, `<vs:sound name="laugh"/>`,
 * `⸨laugh⸩` in IPA) is made of ordinary plan segments: vowels, consonants
 * and releases with the channels of the planner (voicing, aspiration,
 * glottal closure, frication, loudness, the phonation channels `breath` and
 * `creak`) and the tract of a phone. Nothing is recorded and no network is
 * involved: the tract model renders a laugh as it renders a word.
 *
 * `SOUNDS` lists the recipes. Every part has a phone that gives the tract
 * (and, for consonants, the closure), its seconds, its level in dB re a
 * vowel of the voice (`level: [start, end]`) and, for voiced parts, its
 * pitch in semitones (`pitch: [start, end]`) re the voice's pitch
 * (`head.pitch`) or, for the fillers, re the pitch of the syllable before.
 * A `noise` part has no voicing and the glottis open (the glottal noise of
 * src/acoustics/aerodynamics.js, issue 35).
 *
 * The planner (`buildSegments()`) first puts a timed silence of the
 * sound's length where the sound is, as the markup does since issue 50;
 * the rates, the intonation and the durations see that silence. Then
 * `expandSounds()` replaces it with the segments of `soundSegments()`, and
 * `speechSegments()` gives the prosody the silence back, so a sound does
 * not change the pitch or the timing of the words around it.
 *
 * Public Domain (Unlicense).
 */

import { parseIpa } from '../ipa/parse.js';
import { consonantTarget, vowelChannels, vowelTarget } from './phones.js';
import { EFFORT_RULES } from './effort.js';
import { sampleState, tractShape } from './tract-shape.js';
import { tubeFormants } from '../acoustics/transfer.js';
import { piriformBranch } from '../acoustics/waveguide.js';

/**
 * Level (dB) of the glottal noise at an open glottis against a modal vowel
 * at the same `loudness` (the two grow alike with the lung pressure): the
 * loudness of a noise part is raised by its inverse, so that `level` is the
 * level re a vowel of the voice. Measured with
 * `node experiments/issue-56-calibrate.mjs`.
 */
export const NOISE_LEVEL = -16;

/** Length of a laugh call: `h` and the vowel `ə`, 0.1 s each. */
export const LAUGH_CALL = 0.2;

/** Length of a cough: glottal closure 0.06 s and burst 0.15 s. */
export const COUGH_CALL = 0.225;

/** Pitch of the first laugh call re the voice's pitch (Bachorowski 2001). */
export const LAUGH_PITCH = 1.66;

/** Calls of a laugh and coughs of a cough: default, least and most. */
export const CALLS = Object.freeze({
  laugh: Object.freeze({ seconds: LAUGH_CALL, count: 4, min: 1, max: 12 }),
  cough: Object.freeze({ seconds: COUGH_CALL, count: 2, min: 1, max: 12 }),
});

const NOISE = Object.freeze({ voicing: 0, aspiration: 1, glottalClosure: 0 });

const laughPitch = 12 * Math.log2(LAUGH_PITCH);

/** The parts of one laugh call `index` (0 the first). */
function laughCall(index) {
  const level = -1.5 * index;
  const pitch = laughPitch - index;
  return [
    {
      phone: 'h',
      seconds: 0.1,
      level: [level - 4, level - 4],
      pitch: [pitch, pitch],
    },
    {
      phone: 'ə',
      seconds: 0.1,
      level: [level, level],
      pitch: [pitch, pitch],
      phonation: { breathy: 0.5 },
    },
  ];
}

/** The parts of one cough: glottal closure, then a burst of glottal noise. */
function coughCall() {
  return [
    { phone: 'ʔ', seconds: 0.06, level: [0, 0] },
    { phone: 'ɐ', seconds: 0.15, noise: true, level: [0, -12] },
    { phone: null, seconds: COUGH_CALL - 0.21 },
  ];
}

/**
 * The click of `click` and of the click letters (`ǀ ǃ ǁ ʘ`): a closure of
 * 0.04 s at the place of the letter, then a burst of 0.06 s. The glottis
 * closes at the release, so that no lung air follows the burst (no
 * aspiration, no voicing): the burst is the noise of the air that the
 * closure held (src/acoustics/aerodynamics.js, issue 35).
 */
function clickParts(phone) {
  return [
    {
      phone,
      seconds: 0.04,
      level: [-20, -20],
      target: { voicing: 0, aspiration: 0.35 },
    },
    {
      phone,
      release: true,
      seconds: 0.06,
      level: [-20, -20],
      target: { voicing: 0, aspiration: 0, glottalClosure: 1 },
    },
  ];
}

/**
 * Creak of the throat clearing: the glottis lowers the planned f0 by
 * `12 · creak` semitones and adds `10 · creak` % jitter (glottis.js), so
 * that -8 st at creak 0.25 is about 64 Hz for a voice of 120 Hz, still
 * periodic enough to be heard (and tracked) as voice. Creak 1 would halve
 * the f0 below 60 Hz and leave no periodicity
 * (`node experiments/issue-56-throat.mjs`).
 */
const THROAT_CREAK = 0.25;

/**
 * The sounds: default `seconds`, what a stretched sound keeps (`stretch`:
 * all parts in proportion; `calls`: the number of calls), the reference of
 * the `pitch` of the parts (`voice` or `before`, the syllable before) and
 * `parts(context)`, the parts at the default length.
 */
export const SOUNDS = Object.freeze({
  inhale: Object.freeze({
    seconds: 0.4,
    description: 'glottal noise, open glottis, tract of ə, level rising',
    parts: () => [{ phone: 'ə', seconds: 0.4, noise: true, level: [-40, -30] }],
  }),
  exhale: Object.freeze({
    seconds: 0.4,
    description: 'glottal noise, open glottis, tract of ə, level falling',
    parts: () => [{ phone: 'ə', seconds: 0.4, noise: true, level: [-30, -40] }],
  }),
  sigh: Object.freeze({
    seconds: 1.1,
    description: 'inhale 0.4 s, breathy ɐ 0.7 s, f0 -6 st, level -12 dB',
    // Breath 0.7, not 1: a fully breathy vowel has too little periodicity
    // left for its pitch to be heard (or tracked) as a fall
    // (`node experiments/issue-56-sigh.mjs`).
    parts: () => [
      // The pitch of the breathy ɐ already in the inhale (unvoiced), so
      // that the smoothing of f0 does not start the fall lower.
      {
        phone: 'ə',
        seconds: 0.4,
        noise: true,
        level: [-40, -30],
        pitch: [2, 2],
      },
      {
        phone: 'ɐ',
        seconds: 0.7,
        level: [-2, -14],
        pitch: [2, -4],
        phonation: { breathy: 0.7 },
      },
    ],
  }),
  laugh: Object.freeze({
    seconds: LAUGH_CALL * CALLS.laugh.count,
    description: 'calls of h 0.1 s + breathy ə 0.1 s, 5 per second',
    calls: CALLS.laugh,
    parts: ({ calls }) =>
      Array.from({ length: calls }, (_, index) => laughCall(index)).flat(),
  }),
  filler: Object.freeze({
    seconds: 0.35,
    description: 'long steady vowel of the language (FILLERS)',
    reference: 'before',
    parts: ({ language }) => fillerParts('filler', language, 0.35),
  }),
  um: Object.freeze({
    seconds: 0.45,
    description: 'long vowel and m of the language (FILLERS)',
    reference: 'before',
    parts: ({ language }) => fillerParts('um', language, 0.45),
  }),
  cough: Object.freeze({
    seconds: COUGH_CALL * CALLS.cough.count,
    description: 'ʔ 0.06 s, burst of glottal noise 0.15 s (tract of ɐ)',
    calls: CALLS.cough,
    parts: ({ calls }) =>
      Array.from({ length: calls }, () => coughCall()).flat(),
  }),
  throat: Object.freeze({
    seconds: 0.4,
    description: 'ʔ + creaky ə 0.18 s, then ʔ + creaky m 0.18 s',
    parts: () => [
      { phone: 'ʔ', seconds: 0.02, level: [-6, -6] },
      {
        phone: 'ə',
        seconds: 0.18,
        level: [-6, -10],
        pitch: [-8, -9],
        phonation: { creaky: THROAT_CREAK },
      },
      { phone: 'ʔ', seconds: 0.02, level: [-10, -10] },
      {
        phone: 'm',
        seconds: 0.18,
        level: [-10, -14],
        pitch: [-8, -9],
        phonation: { creaky: THROAT_CREAK },
      },
    ],
  }),
  click: Object.freeze({
    seconds: 0.1,
    description: 'dental closure 0.04 s, burst 0.06 s, no lung air',
    parts: () => clickParts('ǀ'),
  }),
});

/**
 * Fillers (hesitation sounds) per language: the IPA of `filler` and `um`.
 * The written forms are `FILLER_WORDS` of the verbalizers
 * (src/g2p/verbalize-*.js).
 */
export const FILLERS = Object.freeze({
  filler: Object.freeze({ en: 'əː', ru: 'ɛː', hi: 'əː', zh: 'ɤː' }),
  um: Object.freeze({ en: 'əːm', ru: 'ɛːm', hi: 'ə̃ː', zh: 'ŋ̍ː' }),
});

/**
 * Pitch of a filler re the syllable before: 2 semitones lower, falling
 * by 1 more.
 */
export const FILLER_PITCH = Object.freeze([-2, -3]);

/** The parts of a filler of `language` (English without one). */
function fillerParts(name, language, seconds) {
  const table = FILLERS[name];
  const ipa = table[baseLanguage(language)] ?? table.en;
  const phones = phoneTokens(ipa);
  const share = phones.length === 1 ? [1] : [0.55, 0.45];
  return phones.map((token, index) => ({
    phone: token,
    seconds: seconds * share[index],
    level: index === 0 ? [-3, -5] : [-5, -8],
    pitch: index === 0 ? FILLER_PITCH : [FILLER_PITCH[1], FILLER_PITCH[1]],
  }));
}

/** `en` of `en-GB`, `ru` of `ru`, null without a language. */
function baseLanguage(language) {
  return typeof language === 'string'
    ? language.toLowerCase().split(/[-_]/u)[0]
    : null;
}

const PHONES = new Map();

/** The tokens of an IPA string (cached, without a word). */
function phoneTokens(ipa) {
  if (!PHONES.has(ipa)) {
    PHONES.set(
      ipa,
      Object.freeze(
        parseIpa(ipa)
          .tokens.filter((token) => token.phoneme)
          .map((token) => Object.freeze({ ...token, word: -1, stress: 0 }))
      )
    );
  }
  return PHONES.get(ipa);
}

/** Whether `name` is a sound of `SOUNDS`. */
export function isSound(name) {
  return Object.hasOwn(SOUNDS, name);
}

/**
 * Number of calls of a laugh or a cough of `seconds` (or the default):
 * `round(seconds / call)`, 1 to 12.
 * @param {string} name
 * @param {number} [seconds]
 */
export function soundCalls(name, seconds) {
  const calls = SOUNDS[name]?.calls;
  if (!calls) {
    return null;
  }
  if (seconds === undefined || seconds === null) {
    return calls.count;
  }
  return Math.min(
    calls.max,
    Math.max(calls.min, Math.round(seconds / calls.seconds))
  );
}

/**
 * Seconds of a sound token at speech rate 1: its `duration`, for a laugh
 * and a cough the length of its calls; else the default of `SOUNDS`.
 * Unknown names last their `duration` or 0.3 s.
 * @param {{name: string, duration?: number}} token
 */
export function soundSeconds(token) {
  const sound = SOUNDS[token.name];
  if (!sound) {
    return token.duration ?? 0.3;
  }
  if (sound.calls) {
    return soundCalls(token.name, token.duration) * sound.calls.seconds;
  }
  return token.duration ?? sound.seconds;
}

/**
 * The length of a sound token in the plan: `soundSeconds()`, divided by
 * the rate of its mode unless the markup gave its duration.
 * @param {{name: string, duration?: number, mode?: {rate?: number}}} token
 */
export function soundLength(token) {
  const seconds = soundSeconds(token);
  const rate = token.mode?.rate ?? 1;
  return token.duration === undefined && rate > 0 ? seconds / rate : seconds;
}

/**
 * The parts of a sound at its default lengths (see `SOUNDS`).
 * @param {{name: string, duration?: number}} token
 * @param {{language?: string|null}} [context]
 */
export function soundParts(token, context = {}) {
  const sound = SOUNDS[token.name];
  if (!sound) {
    return [{ phone: null, seconds: soundSeconds(token) }];
  }
  return sound.parts({
    calls: soundCalls(token.name, token.duration),
    language: token.mode?.lang ?? context.language ?? null,
  });
}

const dbToGain = (decibels) => 10 ** (decibels / 20);

/** The token of a part: a phone with the mode of the sound. */
function partToken(phone, mode) {
  if (typeof phone !== 'string' && phone.mode === mode) {
    return phone; // a click letter keeps its token (timeline, durations)
  }
  const token = typeof phone === 'string' ? phoneTokens(phone)[0] : phone;
  return { ...token, mode };
}

/** One plan segment of a part. */
function partSegment(part, duration, mode) {
  if (!part.phone) {
    return {
      kind: 'pause',
      strength: 1,
      target: { voicing: 0, loudness: 0 },
      duration,
    };
  }
  const token = partToken(part.phone, mode);
  const loudness = dbToGain(part.level[0] - (part.noise ? NOISE_LEVEL : 0));
  const envelope = part.level[1] - part.level[0];
  const extra = {
    ...(part.noise ? NOISE : {}),
    ...part.target,
    loudness,
  };
  const segment =
    token.kind === 'vowel'
      ? {
          token,
          kind: 'vowel',
          vowel: vowelTarget(token),
          target: { ...vowelChannels(token), ...extra },
        }
      : {
          token,
          kind: part.release ? 'release' : 'consonant',
          target: part.release
            ? { frication: consonantTarget(token).frication, ...extra }
            : { ...consonantTarget(token), ...extra },
        };
  segment.duration = duration;
  if (envelope !== 0) {
    segment.envelope = envelope;
  }
  if (part.noise) {
    segment.noise = true;
  }
  if (part.pitch) {
    segment.soundPitch = part.pitch;
  }
  if (part.phonation) {
    segment.phonation = part.phonation;
  }
  return segment;
}

/**
 * The plan segments of a sound token that lasts `seconds`: its parts
 * (`soundParts()`) stretched to that length, each with the mode of the
 * token. A vowel part has `vowel` and `target` as a vowel of
 * `buildSegments()`, a consonant part `target`; `envelope` is the change
 * of level in dB over the part, `soundPitch` its pitch in semitones and
 * `phonation` the degrees of its phonation (see `phonationChannels()`).
 * @param {{name: string, duration?: number, mode?: object}} token
 * @param {{seconds?: number, language?: string|null}} [context]
 */
export function soundSegments(token, context = {}) {
  const parts = soundParts(token, context);
  const total = parts.reduce((sum, part) => sum + part.seconds, 0);
  const seconds = context.seconds ?? soundLength(token);
  const factor = total > 0 ? seconds / total : 1;
  return parts.map((part) =>
    partSegment(part, part.seconds * factor, token.mode)
  );
}

/**
 * The segments of a click letter (`ǀ ǃ ǁ ʘ`): the parts of the `click`
 * sound at the place of the letter. `applyRates()` divides them by the
 * rate of the mode, as `soundLength()` divides the `click` sound.
 * @param {object} token a consonant token with `phoneme.manner` `click`
 */
export function clickSegments(token) {
  return clickParts(token).map((part) =>
    partSegment(part, part.seconds, token.mode)
  );
}

/** Pauses after which `breaths` puts an inhale. */
const BREATH_PAUSES = new Set(['.', '‖', '?', '!']);

/**
 * Breaths between sentences (`breaths` option of `synthesize()`): the
 * least pause that gets one, the length of an inhale before `n` syllables
 * (`min(max, base + perSyllable * n)` seconds) and the silence between the
 * end of the breath and the next word.
 */
export const BREATHS = Object.freeze({
  minPause: 0.3,
  base: 0.3,
  perSyllable: 0.03,
  max: 0.7,
  gap: 0.05,
  before: 0.05,
});

/** Whether a segment is the nucleus of a syllable. */
const isSyllable = (segment) =>
  segment.kind === 'vowel' || Boolean(segment.token?.syllabic);

/** Whether a pause ends a sentence (`.`, `?`, `!`, `‖`). */
function endsSentence(segment) {
  const token = segment.token;
  return (
    segment.kind === 'pause' &&
    !segment.sound &&
    Boolean(token) &&
    (BREATH_PAUSES.has(token.symbol) || Boolean(token.question))
  );
}

/**
 * Put an inhale into every pause of at least `BREATHS.minPause` seconds
 * after `.`, `?`, `!` or `‖` that has speech before and after it: a timed
 * `inhale` sound of `min(0.7, 0.3 + 0.03 n)` seconds (`n` syllables up to
 * the next such pause) that ends `BREATHS.gap` before the next word. The
 * pause gets longer when the breath does not fit. Runs on the segments of
 * `buildSegments()` before they get their times.
 * @param {object[]} segments
 * @returns {object[]} the segments with the breaths
 */
export function insertBreaths(segments) {
  const result = [];
  let spoken = false;
  segments.forEach((segment, index) => {
    result.push(segment);
    if (isSyllable(segment)) {
      spoken = true;
    }
    if (!spoken || !endsSentence(segment)) {
      return;
    }
    if (segment.duration < BREATHS.minPause) {
      return;
    }
    let syllables = 0;
    for (let next = index + 1; next < segments.length; next++) {
      if (endsSentence(segments[next])) {
        break;
      }
      if (isSyllable(segments[next]) && !segments[next].sound) {
        syllables++;
      }
    }
    if (syllables === 0) {
      return;
    }
    const breath = Math.min(
      BREATHS.max,
      BREATHS.base + BREATHS.perSyllable * syllables
    );
    const silence = Math.max(
      BREATHS.before,
      segment.duration - breath - BREATHS.gap
    );
    segment.duration = silence;
    const mode = segment.token.mode;
    const token = { kind: 'sound', name: 'inhale', word: -1, mode };
    result.push(
      {
        token,
        kind: 'pause',
        strength: 1,
        boundary: 'word',
        question: false,
        target: { voicing: 0, loudness: 0 },
        duration: breath,
        timed: true,
        sound: 'inhale',
        breath: true,
      },
      {
        kind: 'pause',
        strength: 1,
        target: { voicing: 0, loudness: 0 },
        duration: BREATHS.gap,
        timed: true,
      }
    );
  });
  return result;
}

/**
 * Replace every sound silence of `buildSegments()` (a segment with
 * `sound`) by the segments of `soundSegments()`, before the segments get
 * their times. Each part keeps the silence in `soundOf`.
 * @param {object[]} segments
 * @param {{language?: string|null}} [context]
 * @returns {object[]}
 */
export function expandSounds(segments, context = {}) {
  const result = [];
  for (const segment of segments) {
    if (!segment.sound || segment.soundOf) {
      result.push(segment);
      continue;
    }
    const parts = soundSegments(segment.token, {
      ...context,
      seconds: segment.duration,
    });
    for (const part of parts) {
      part.sound = segment.sound;
      part.soundOf = segment;
      result.push(part);
    }
  }
  return result;
}

/**
 * The segments the prosody sees: every run of the parts of one sound is
 * its silence again (with the start and end of the run), so pitch,
 * intonation, register gains and the effort ramps do not change with
 * the sounds.
 * @param {object[]} segments timed segments
 */
export function speechSegments(segments) {
  const result = [];
  for (const segment of segments) {
    const silence = segment.soundOf;
    if (!silence) {
      result.push(segment);
      continue;
    }
    if (result.at(-1) !== silence) {
      silence.start = segment.start;
      result.push(silence);
    }
    silence.end = segment.end;
  }
  return result;
}

/** The sounds of a plan: `{name, start, end}` in seconds. */
export function planSounds(segments) {
  return speechSegments(segments)
    .filter((segment) => segment.sound)
    .map(({ sound, start, end }) => ({ name: sound, start, end }));
}

function frameSpan(segment, frameRate, frameCount) {
  const first = Math.round(segment.start * frameRate);
  const last = Math.min(frameCount, Math.round(segment.end * frameRate));
  return [first, Math.max(first + 1, last)];
}

/**
 * The level of the sound parts: the loudness of each part (its target)
 * moves by its `envelope` (dB) from its start to its end.
 * @param {Float32Array} loudness the loudness steps of `fillDefaults()`
 * @param {object[]} segments timed segments
 * @param {number} frameRate
 */
export function applySoundLevels(loudness, segments, frameRate) {
  for (const segment of segments) {
    if (!segment.envelope) {
      continue;
    }
    const [first, last] = frameSpan(segment, frameRate, loudness.length);
    const span = Math.max(1, last - first - 1);
    for (let frame = first; frame < last; frame++) {
      loudness[frame] *= dbToGain((segment.envelope * (frame - first)) / span);
    }
  }
}

/**
 * The model of the level of a voiced part against its f0: the harmonics
 * of a source falling by `slope` (power, per harmonic number) through two
 * resonances at the first two formants of the tract with the bandwidths
 * `b1` and `b2` (Hz). Fitted to the waveguide (tier medium) on the laugh
 * vowel at 141-251 Hz: 0.23 dB rms (experiments/issue-56-resonance-fit.mjs).
 * A harmonic on F1 makes a vowel up to 5 dB louder than one between two
 * harmonics, more than the 1.5 dB steps of a laugh.
 */
export const HARMONIC_MODEL = Object.freeze({
  b1: 60,
  b2: 100,
  slope: 3,
  maxFrequency: 4000,
});

function resonancePower(frequency, formant, bandwidth) {
  const real = 1 - (frequency / formant) ** 2;
  const imaginary = (frequency * bandwidth) / (formant * formant);
  return 1 / (real * real + imaginary * imaginary);
}

/**
 * The level (dB, up to a constant) of a voice at `f0` through the
 * formants `[f1, f2]` (HARMONIC_MODEL).
 * @param {number} f0 Hz
 * @param {number[]} formants Hz
 */
export function harmonicGain(f0, [f1, f2]) {
  const { b1, b2, slope, maxFrequency } = HARMONIC_MODEL;
  let power = 0;
  for (let harmonic = 1; harmonic * f0 < maxFrequency; harmonic++) {
    const frequency = harmonic * f0;
    power +=
      (resonancePower(frequency, f1, b1) * resonancePower(frequency, f2, b2)) /
      harmonic ** slope;
  }
  return 10 * Math.log10(power);
}

/**
 * F1 and F2 of the tract at `time`: the tube model with the piriform
 * fossae of the waveguide.
 */
function formantsAt(plan, head, time) {
  const { areas, length } = tractShape(sampleState(plan, time), head);
  return tubeFormants(areas, length, {
    head,
    count: 2,
    maxFrequency: 3000,
    branches: [piriformBranch(areas.length, length, head)],
  });
}

/** The voiced vowels of every sound (by placeholder), in order. */
function voicedSoundVowels(segments) {
  const vowels = new Map();
  for (const segment of segments) {
    if (
      segment.soundOf &&
      segment.kind === 'vowel' &&
      segment.soundPitch &&
      !segment.noise &&
      !(segment.token?.mode?.phonation?.whisper > 0)
    ) {
      const list = vowels.get(segment.soundOf) ?? [];
      list.push(segment);
      vowels.set(segment.soundOf, list);
    }
  }
  return vowels;
}

/**
 * Keep the planned level steps of the voiced vowels of a sound (the calls
 * of a laugh) in the sound: each vowel after the first is raised or
 * lowered by the change of `harmonicGain()` between its f0 and the f0 of
 * the first one, at the formants of the first one (the vowels of a sound
 * share their phone). Runs after `applySoundPitch()`, on the loudness
 * steps; a sound with one voiced vowel is left alone.
 * @param {Record<string, Float32Array>} channels the plan channels (f0,
 *   loudness and the tract channels filled)
 * @param {object[]} segments timed segments
 * @param {object} head
 * @param {number} frameRate
 */
export function applySoundHarmonics(channels, segments, head, frameRate) {
  const frameCount = channels.f0.length;
  const plan = { channels, frameRate, frameCount };
  for (const list of voicedSoundVowels(segments).values()) {
    if (list.length < 2) {
      continue;
    }
    const middle = (segment) =>
      Math.min(
        frameCount - 1,
        Math.round(((segment.start + segment.end) / 2) * frameRate)
      );
    const formants = formantsAt(plan, head, middle(list[0]) / frameRate);
    if (formants.length < 2) {
      continue;
    }
    const reference = harmonicGain(channels.f0[middle(list[0])], formants);
    for (const segment of list.slice(1)) {
      const change =
        harmonicGain(channels.f0[middle(segment)], formants) - reference;
      const [first, last] = frameSpan(segment, frameRate, frameCount);
      const gain = dbToGain(-change);
      for (let frame = first; frame < last; frame++) {
        channels.loudness[frame] *= gain;
      }
    }
  }
}

/** The pitch (Hz) at the end of the last vowel of speech before `time`. */
function pitchBefore(f0, segments, time, frameRate, fallback) {
  let found = null;
  for (const segment of segments) {
    if (segment.start >= time) {
      break;
    }
    if (segment.kind === 'vowel' && !segment.soundOf) {
      found = segment;
    }
  }
  if (!found) {
    return fallback;
  }
  const frame = Math.min(f0.length - 1, Math.round(found.end * frameRate) - 1);
  return f0[Math.max(0, frame)];
}

/**
 * The pitch of the voiced sound parts (`soundPitch`, semitones): re the
 * voice's pitch, moved by the `pitch` of the mode, or for the fillers re
 * the pitch at the end of the syllable before (the pitch curve of
 * `fillPitch()`); the effort raises it as it raises speech.
 * @param {Float32Array} f0 pitch of `fillPitch()` (Hz per frame)
 * @param {object[]} segments timed segments
 * @param {object} head
 * @param {number} frameRate
 * @param {Float32Array} [effort] the effort channel (dB)
 */
export function applySoundPitch(f0, segments, head, frameRate, effort) {
  const before = new Map();
  const curve = Float32Array.from(f0);
  for (const segment of segments) {
    if (!segment.soundPitch || !segment.soundOf) {
      continue;
    }
    const silence = segment.soundOf;
    const mode = segment.token?.mode;
    let base = head.pitch * 2 ** ((mode?.pitch ?? 0) / 12);
    if (SOUNDS[silence.sound]?.reference === 'before') {
      if (!before.has(silence)) {
        before.set(
          silence,
          pitchBefore(curve, segments, segment.start, frameRate, base)
        );
      }
      base = before.get(silence);
    }
    const [from, to] = segment.soundPitch;
    const [first, last] = frameSpan(segment, frameRate, f0.length);
    const span = Math.max(1, last - first - 1);
    for (let frame = first; frame < last; frame++) {
      const step = from + ((to - from) * (frame - first)) / span;
      let value = base * 2 ** (step / 12);
      if (effort && effort[frame] !== 0) {
        value *= 2 ** (EFFORT_RULES.pitch.value(effort[frame], head) / 12);
      }
      f0[frame] = value;
    }
  }
  holdSoundPitch(f0, segments, frameRate);
}

/**
 * Hold the last f0 of a sound through the pause after it: the pause is
 * silent, and the zero-phase smoothing of f0 would otherwise pull the end
 * of the sound toward the pitch of the pause.
 */
function holdSoundPitch(f0, segments, frameRate) {
  let held = null;
  for (const segment of segments) {
    const [first, last] = frameSpan(segment, frameRate, f0.length);
    if (segment.soundPitch && segment.soundOf) {
      held = last > first ? f0[last - 1] : held;
    } else if (segment.kind === 'pause' && held !== null) {
      f0.fill(held, first, last);
    } else {
      held = null;
    }
  }
}
