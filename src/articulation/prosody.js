/**
 * Punctuation prosody: how long each pause lasts, which tune ends a
 * phrase, how pitch declines through a sentence, and how exclamations and
 * parentheticals shift the voice register.
 *
 * The parser tags every pause with a boundary class (see
 * `BOUNDARY_CLASSES` in `src/ipa/inventory.js`). Defaults per class:
 *
 * | boundary    | written as   | pause  | tune (intonation.js)  | final lengthening |
 * | ----------- | ------------ | ------ | --------------------- | ----------------- |
 * | word        | space        | 12 ms  | none                  | none              |
 * | quote       | `"`          | 60 ms  | none                  | none              |
 * | paren       | `(` `)`      | 180 ms | parenthesis           | x1.2              |
 * | comma       | `,`          | 200 ms | continuation          | x1.3              |
 * | dash        | `\|` (—)     | 220 ms | continuation          | x1.3              |
 * | semicolon   | `;` `:`      | 300 ms | statement             | x1.35             |
 * | period      | `.` `‖`      | 420 ms | statement             | x1.4              |
 * | exclamation | `!`          | 420 ms | exclamation           | x1.4              |
 * | question    | `?`          | 420 ms | yes/no question       | x1.4              |
 * | ellipsis    | `…`          | 650 ms | statement             | x1.8              |
 *
 * The tunes are in intonation.js (issue 51): every language maps the
 * sentence type onto its own tunes (English nuclear tones, the Russian
 * intonation constructions IK1 to IK7, Hindi accent phrases, a Mandarin
 * question raise). The text front end writes the sentence type before the
 * mark (src/g2p/phrasing.js): `↘ ?` for a question with a question word
 * (it falls), `↗ ?` for an echo question or an asking tag, `↗ |` before the
 * `or` of an alternative question, `{IK4 … IK4}` and `{IK5 … IK5}` for
 * Russian а-questions and как-exclamations, and `|` before the conjunction
 * nearest to the middle of a stretch of more than 14 syllables; the phrase
 * before `|` gets the continuation tune (Russian: IK3 at 0.7). A tune label
 * (`{IK3 … IK3}`, `[tune yesno]`, `<vs:tune name="echo">`) overrides the
 * punctuation. The head's `pauseLength` scales every pause and its
 * `finalLengthening` is the factor at a period; the other boundaries
 * scale with it.
 *
 * Declination: pitch falls 2 semitones (the head's `declination`) across
 * each intonation phrase and each later phrase of the same sentence starts
 * half that lower (at most 3 steps); sentence ends (`.`, `!`, `?`, `…`)
 * reset it. Exclamation sentences are 1.5 semitones higher with a 1.3x
 * accent range and +3 dB; segments inside parentheses are 2 semitones
 * lower with a 0.7x range and -3 dB.
 *
 * Tonal languages keep their lexical tones and only get the declination,
 * the register shifts and the Mandarin question raise (`TUNES.zh`). Every
 * Chao level of a tone is a pitch target, so a contour tone such as the
 * Mandarin third tone `˨˩˦` falls to its lowest level before it rises. The
 * targets sit at the fractions of the syllable in `TONE_POINT_POSITIONS`:
 * the ends for two levels, `0, 0.4, 1` for three (the low point comes
 * before the middle of the vowel, Xu 1997, figure 3) and evenly spaced for
 * more. A single-level tone is level. In a phrase with tones the voice
 * approaches the targets of one syllable after the other from where the
 * last syllable ended (the tone model of issue 49 in tone-model.js); a
 * syllable without tone and stress mark is the neutral tone, whose level
 * depends on the tone before it, and a stressed syllable without tone gets
 * the final contour of `CONTOURS` (`phraseContour()`, `syllablePitch()`).
 */

import {
  analyzeIntonation,
  FOCUS,
  intonationGains,
  intonationTargets,
} from './intonation.js';
import { TONE_RATES, neutralLevel, toneIntervals } from './tone-model.js';

/** Pause length (s), final contour and final-syllable lengthening. */
export const BOUNDARIES = Object.freeze({
  word: Object.freeze({ pause: 0.012 }),
  quote: Object.freeze({ pause: 0.06 }),
  paren: Object.freeze({ pause: 0.18, contour: 'level', lengthen: 1.2 }),
  comma: Object.freeze({
    pause: 0.2,
    contour: 'continuation',
    lengthen: 1.3,
  }),
  dash: Object.freeze({
    pause: 0.22,
    contour: 'continuation',
    lengthen: 1.3,
  }),
  semicolon: Object.freeze({
    pause: 0.3,
    contour: 'halfFall',
    lengthen: 1.35,
  }),
  period: Object.freeze({
    pause: 0.42,
    contour: 'fall',
    lengthen: 1.4,
    sentence: true,
  }),
  exclamation: Object.freeze({
    pause: 0.42,
    contour: 'emphatic',
    lengthen: 1.4,
    sentence: true,
    register: 'exclamation',
  }),
  question: Object.freeze({
    pause: 0.42,
    contour: 'rise',
    lengthen: 1.4,
    sentence: true,
  }),
  ellipsis: Object.freeze({
    pause: 0.65,
    contour: 'trail',
    lengthen: 1.8,
    sentence: true,
  }),
});

/** Final pitch movement in semitones: `[perRange, offset]`. */
export const CONTOURS = Object.freeze({
  fall: Object.freeze([-0.8, -1]),
  rise: Object.freeze([1.5, 1]),
  emphatic: Object.freeze([-1, -1.5]),
  continuation: Object.freeze([1, 0.5]),
  halfFall: Object.freeze([-0.4, -0.5]),
  level: Object.freeze([0, 0]),
  trail: Object.freeze([-0.3, 0]),
});

/** Register shifts: pitch offset (semitones), accent range and gain. */
export const REGISTERS = Object.freeze({
  neutral: Object.freeze({ shift: 0, range: 1, gain: 1 }),
  exclamation: Object.freeze({ shift: 1.5, range: 1.3, gain: 1.41 }),
  parenthetical: Object.freeze({ shift: -2, range: 0.7, gain: 0.71 }),
});

/** Pitch declination in semitones. */
export const DECLINATION = Object.freeze({ phrase: 2, step: 1, maxStep: 3 });

/** Boundary class of pauses that were built without one. */
const STRENGTH_BOUNDARIES = ['word', 'quote', 'comma', 'period'];

/** The boundary class of a pause token or segment. */
export function boundaryOf(pause) {
  if (!pause) {
    return 'period';
  }
  return (
    pause.boundary ?? STRENGTH_BOUNDARIES[Math.min(3, pause.strength ?? 0)]
  );
}

/** Pause length in seconds for a pause token. */
export function pauseDuration(pause) {
  return BOUNDARIES[boundaryOf(pause)]?.pause ?? BOUNDARIES.word.pause;
}

/** Lengthening of the last syllable before a phrase boundary. */
export function finalLengthening(boundary) {
  return BOUNDARIES[boundary]?.lengthen ?? 1.4;
}

/** The final contour of a phrase that ends at `pause`. */
export function phraseContour(pause) {
  if (pause?.contour) {
    return pause.contour;
  }
  if (pause?.question) {
    return 'rise';
  }
  return BOUNDARIES[boundaryOf(pause)]?.contour ?? 'fall';
}

function isNucleus(segment) {
  return segment.kind === 'vowel' || Boolean(segment.token?.syllabic);
}

/**
 * Group syllable nuclei into intonation phrases (split at pauses of
 * strength 2 or more) and phrases into sentences.
 * @param {object[]} segments
 */
export function intonationPhrases(segments) {
  const phrases = [];
  let nuclei = [];
  let step = 0;
  const close = (pause) => {
    if (nuclei.length) {
      phrases.push({
        nuclei,
        pause,
        step: Math.min(step, DECLINATION.maxStep),
      });
      step++;
    }
    nuclei = [];
  };
  for (const segment of segments) {
    if (segment.kind === 'pause' && segment.strength >= 2) {
      close(segment);
      if (BOUNDARIES[boundaryOf(segment)]?.sentence) {
        step = 0;
      }
    } else if (segment.kind !== 'pause' && isNucleus(segment)) {
      nuclei.push(segment);
    }
  }
  close(null);
  markSentenceRegisters(phrases);
  return phrases;
}

/** Every phrase of a sentence takes the register of the sentence end. */
function markSentenceRegisters(phrases) {
  let start = 0;
  phrases.forEach((phrase, index) => {
    const boundary = BOUNDARIES[boundaryOf(phrase.pause)];
    if (!boundary?.sentence && index < phrases.length - 1) {
      return;
    }
    const register = boundary?.register ?? 'neutral';
    for (const member of phrases.slice(start, index + 1)) {
      member.register = register;
    }
    start = index + 1;
  });
}

/** Combined register of one segment within its phrase. */
export function segmentRegister(segment, phrase) {
  const sentence = REGISTERS[phrase?.register ?? 'neutral'];
  if (!segment.token?.parenthetical) {
    return sentence;
  }
  const inner = REGISTERS.parenthetical;
  return {
    shift: sentence.shift + inner.shift,
    range: sentence.range * inner.range,
    gain: sentence.gain * inner.gain,
  };
}

const semitones = (base, steps) => base * 2 ** (steps / 12);

/**
 * Where each pitch target of a nucleus sits, as fractions of the nucleus,
 * by number of targets. Counts not listed are evenly spaced.
 */
export const TONE_POINT_POSITIONS = Object.freeze({
  3: Object.freeze([0, 0.4, 1]),
});

/**
 * Fractions of the nucleus at which `count` pitch targets sit.
 * @param {number} count
 * @returns {readonly number[]}
 */
export function pointPositions(count) {
  if (TONE_POINT_POSITIONS[count]) {
    return TONE_POINT_POSITIONS[count];
  }
  if (count < 2) {
    return [0];
  }
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

/**
 * One pitch (Hz) per Chao tone level (1 lowest, 5 highest, 3 = `base`).
 * A single-level tone gives its level twice so the pitch stays level.
 * @param {number[]} tone
 * @param {number} base
 * @param {number} scale Semitones per tone level.
 * @returns {number[]}
 */
export function tonePitch(tone, base, scale) {
  const levels = tone.length === 1 ? [tone[0], tone[0]] : tone;
  return levels.map((level) => semitones(base, (level - 3) * scale));
}

/**
 * Pitch shift of a nucleus in semitones from `head.pitch` (register shift
 * and the `pitch` of its speech mode minus declination), its accent range
 * and its tone scale (semitones per Chao level), both times the `range` of
 * its mode. `options.declination` scales the declination within the
 * phrase (a Mandarin question halves it).
 * @param {object} segment
 * @param {object} head
 * @param {object} phrase
 * @param {{declination?: number}} [options]
 */
export function pitchShift(segment, head, phrase, options = {}) {
  const { nuclei } = phrase;
  const phraseStart = nuclei[0].start;
  const span = Math.max(0.2, nuclei.at(-1).end - phraseStart);
  const progress = (segment.start - phraseStart) / span;
  const register = segmentRegister(segment, phrase);
  // The head's declination replaces the 2-semitone default and scales the
  // step between phrases with it.
  const declination = head.declination ?? DECLINATION.phrase;
  // The speech mode (docs/markup.md): `pitch` in semitones, `range` a
  // factor of the accent range and of the tone scale.
  const mode = segment.token?.mode;
  const modeRange = mode?.range ?? 1;
  return {
    shift:
      register.shift +
      (mode?.pitch ?? 0) -
      declination * (options.declination ?? 1) * progress -
      (DECLINATION.step * phrase.step * declination) / DECLINATION.phrase,
    range: head.pitchRange * register.range * modeRange,
    scale: (1.2 + 0.35 * head.pitchRange) * register.range * modeRange,
  };
}

/**
 * Pitch targets (Hz) of a syllable nucleus: start and end, or one per
 * level of a lexical tone.
 * @param {object} segment
 * @param {{head: object, phrase: object, last: boolean}} context
 */
export function syllablePitch(segment, context) {
  const { head, phrase } = context;
  const { shift, range, scale } = pitchShift(segment, head, phrase);
  const base = semitones(head.pitch, shift);
  const tone = segment.token.tone;
  if (tone) {
    return tonePitch(tone, base, scale);
  }
  const accent =
    segment.token.stress === 1 ? range * (head.accentStrength ?? 1) : 0;
  const accented = semitones(base, accent);
  if (!context.last) {
    return [accented, semitones(base, accent * 0.6)];
  }
  const [perRange, offset] = CONTOURS[phraseContour(phrase.pause)];
  return [accented, semitones(base, perRange * range + offset)];
}

/** Whether a phrase carries a lexical tone. */
export function isTonalPhrase(phrase) {
  return phrase.nuclei.some((segment) => segment.token?.tone?.length);
}

const toSemitones = (pitch, reference) => 12 * Math.log2(pitch / reference);

/**
 * Tone range factor and lowering (semitones) of a syllable in a phrase
 * with a focus (`FOCUS.zh`): wider on the focus, narrower and lower after.
 */
function focusShape(focus, focused, afterFocus) {
  if (focused) {
    return { factor: 1 + (FOCUS.zh.scale - 1) * focus.strength, lower: 0 };
  }
  if (afterFocus) {
    return {
      factor: 1 - (1 - FOCUS.zh.after) * focus.strength,
      lower: FOCUS.zh.level * focus.strength,
    };
  }
  return { factor: 1, lower: 0 };
}

/**
 * Tone-model intervals of one syllable: the levels of its tone, the start
 * and end of `syllablePitch()` for a stressed syllable without tone, or
 * the neutral level after `previousTone`.
 */
function syllableIntervals(syllable) {
  const { carrier, stressed, level, duration, lower, context } = syllable;
  if (carrier) {
    return toneIntervals(carrier.token.tone, duration).map((interval) => ({
      ...interval,
      from: level(interval.from),
      to: level(interval.to),
    }));
  }
  if (stressed) {
    const { head, segment } = context;
    const points = syllablePitch(segment, context);
    const [from, to] = [points[0], points.at(-1)].map(
      (pitch) => toSemitones(pitch, head.pitch) + lower
    );
    return [{ duration, from, to, rate: TONE_RATES.level }];
  }
  const value = level(neutralLevel(syllable.previousTone));
  return [{ duration, from: value, to: value, rate: TONE_RATES.neutral }];
}

/**
 * Pitch targets of the syllables of a phrase with tones (issue 49): one
 * target per syllable, in semitones from `head.pitch`. A Chao level
 * becomes `shift + (level − 3) × scale`. A syllable without tone and
 * without stress mark is neutral: one level target at `neutralLevel()` of
 * the tone before it, approached slowly (`TONE_RATES.neutral`). A stressed
 * syllable without tone keeps the start and end of `syllablePitch()`.
 * Tones are never replaced (issue 51, `TUNES.zh` in intonation.js): a
 * question adds a raise that grows linearly over the phrase (`phrase.zh`),
 * may soften the declination and widen the last tone; a focus widens the
 * tones of its word and narrows and lowers those after it (`FOCUS.zh`).
 */
function tonalTargets(phrase, head) {
  const { syllables, zh, focus } = phrase;
  const targets = [];
  let previousTone = null;
  const phraseStart = syllables[0][0].start;
  const span = Math.max(0.2, phrase.nuclei.at(-1).end - phraseStart);
  const raiseAt = (time) =>
    zh ? zh.raise * Math.min(1, Math.max(0, (time - phraseStart) / span)) : 0;
  let afterFocus = false;
  // Issue 49: the interval of syllable k runs from the end of nucleus
  // k − 1 to the end of nucleus k; the first one starts with its own
  // nucleus (its first voiced frame).
  let start = phraseStart;
  syllables.forEach((nuclei, index) => {
    const carrier = nuclei.findLast((item) => item.token?.tone?.length);
    const segment = carrier ?? nuclei.at(-1);
    const end = nuclei.at(-1).end;
    const duration = Math.max(1e-6, end - start);
    const last = index === syllables.length - 1;
    const { shift, scale: baseScale } = pitchShift(nuclei[0], head, phrase, {
      declination: zh?.declination ?? 1,
    });
    const focused = Boolean(focus) && nuclei[0].token?.word === focus.word;
    const { factor, lower } = focusShape(focus, focused, afterFocus);
    const scale = baseScale * (last ? (zh?.lastScale ?? 1) : 1) * factor;
    afterFocus ||= focused;
    const stressed = nuclei.some((item) => item.token?.stress > 0);
    let intervals = syllableIntervals({
      carrier,
      stressed,
      level: (value) => shift + lower + (value - 3) * scale,
      duration,
      lower,
      previousTone,
      context: { head, phrase, last, segment: nuclei[0] },
    });
    // The question raise at the start and end of every interval.
    let time = start;
    intervals = intervals.map((interval) => {
      const from = interval.from + raiseAt(time);
      time += interval.duration;
      return { ...interval, from, to: interval.to + raiseAt(time) };
    });
    const points = carrier
      ? tonePitch(
          carrier.token.tone,
          semitones(head.pitch, shift + lower + raiseAt(end)),
          scale
        )
      : [intervals[0].from, intervals.at(-1).to].map((value) =>
          semitones(head.pitch, value)
        );
    targets.push({
      segment,
      nuclei,
      phrase,
      start,
      end,
      neutral: !carrier && !stressed,
      from: points[0],
      to: points.at(-1),
      points,
      intervals,
    });
    previousTone = carrier?.token.tone ?? null;
    start = end;
  });
  return targets;
}

/**
 * Pitch targets of every syllable in the utterance, one entry per
 * syllable: `segment` is its stressed nucleus or tone carrier, `nuclei`
 * all its nuclei, `points` has one pitch (Hz) per target (two, or one per
 * tone level) and `from` and `to` are its first and last value.
 * `intervals` are the pitch targets of the tone model in semitones from
 * `head.pitch` (`approachTargets()` in tone-model.js), `start` and `end`
 * the syllable's interval in seconds (from the end of the syllable before
 * it, or the start of the first nucleus, to the end of its last nucleus),
 * with its `phrase` and whether it is `neutral`. Phrases with tones follow
 * `tonalTargets()`, the others the tunes of intonation.js.
 * @param {object[]} segments
 * @param {object} head
 * @param {string} [language] language of the utterance (tunes)
 * @returns {{segment: object, from: number, to: number, points: number[], intervals?: object[]}[]}
 */
export function pitchTargets(segments, head, language) {
  const targets = [];
  for (const phrase of analyzeIntonation(segments, language).phrases) {
    targets.push(
      ...(isTonalPhrase(phrase)
        ? tonalTargets(phrase, head)
        : intonationTargets(phrase, head))
    );
  }
  return targets;
}

/**
 * Loudness gain of each voiced segment from its register and intonation
 * (an English focus, the centre of IK2).
 * @param {object[]} segments
 * @param {string} [language]
 * @returns {{segment: object, gain: number}[]}
 */
export function registerGains(segments, language) {
  const gains = [];
  let phraseIndex = 0;
  const phrases = intonationPhrases(segments);
  const tunes = intonationGains(segments, language);
  for (const segment of segments) {
    if (segment.kind === 'pause') {
      if (segment.strength >= 2 && phrases[phraseIndex]?.pause === segment) {
        phraseIndex++;
      }
      continue;
    }
    const gain =
      segmentRegister(segment, phrases[phraseIndex]).gain *
      (tunes.get(segment) ?? 1);
    if (gain !== 1) {
      gains.push({ segment, gain });
    }
  }
  return gains;
}
