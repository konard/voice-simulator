/**
 * Punctuation prosody: how long each pause lasts, how the pitch moves at
 * the end of a phrase, how pitch declines through a sentence, and how
 * exclamations and parentheticals shift the voice register.
 *
 * The parser tags every pause with a boundary class (see
 * `BOUNDARY_CLASSES` in `src/ipa/inventory.js`). Defaults per class:
 *
 * | boundary    | written as   | pause  | final contour        | final lengthening |
 * | ----------- | ------------ | ------ | -------------------- | ----------------- |
 * | word        | space        | 12 ms  | none                 | none              |
 * | quote       | `"`          | 60 ms  | none                 | none              |
 * | paren       | `(` `)`      | 180 ms | level                | x1.2              |
 * | comma       | `,`          | 200 ms | continuation rise    | x1.3              |
 * | dash        | `\|` (—)     | 220 ms | level                | x1.3              |
 * | semicolon   | `;` `:`      | 300 ms | half fall            | x1.35             |
 * | period      | `.` `‖`      | 420 ms | fall                 | x1.4              |
 * | exclamation | `!`          | 420 ms | emphatic fall        | x1.4              |
 * | question    | `?`          | 420 ms | rise (yes/no)        | x1.4              |
 * | ellipsis    | `…`          | 650 ms | trailing, slight fall| x1.8              |
 *
 * A question that starts with a question word is written `↘ ?` by the
 * text front end and falls; `↗` forces a rise on the next phrase end.
 * Final contours are in semitones, `perRange * pitchRange + offset`.
 *
 * Declination: pitch falls 2 semitones across each intonation phrase and
 * each later phrase of the same sentence starts 1 semitone lower (at most
 * 3); sentence ends (`.`, `!`, `?`, `…`) reset it. Exclamation sentences
 * are 1.5 semitones higher with a 1.3x accent range and +3 dB; segments
 * inside parentheses are 2 semitones lower with a 0.7x range and -3 dB.
 * Tonal languages keep their lexical tones and only get the declination
 * and register shifts.
 */

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
  dash: Object.freeze({ pause: 0.22, contour: 'level', lengthen: 1.3 }),
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
 * Pitch targets (Hz) at the start and end of a syllable nucleus.
 * @param {object} segment
 * @param {{head: object, phrase: object, last: boolean}} context
 */
export function syllablePitch(segment, context) {
  const { head, phrase } = context;
  const { nuclei } = phrase;
  const phraseStart = nuclei[0].start;
  const span = Math.max(0.2, nuclei.at(-1).end - phraseStart);
  const progress = (segment.start - phraseStart) / span;
  const register = segmentRegister(segment, phrase);
  const range = head.pitchRange * register.range;
  const base = semitones(
    head.pitch,
    register.shift -
      DECLINATION.phrase * progress -
      DECLINATION.step * phrase.step
  );
  const tone = segment.token.tone;
  if (tone) {
    const scale = (1.2 + 0.35 * head.pitchRange) * register.range;
    return [
      semitones(base, (tone[0] - 3) * scale),
      semitones(base, (tone.at(-1) - 3) * scale),
    ];
  }
  const accent = segment.token.stress === 1 ? range : 0;
  const accented = semitones(base, accent);
  if (!context.last) {
    return [accented, semitones(base, accent * 0.6)];
  }
  const [perRange, offset] = CONTOURS[phraseContour(phrase.pause)];
  return [accented, semitones(base, perRange * range + offset)];
}

/**
 * Start and end pitch of every syllable nucleus in the utterance.
 * @param {object[]} segments
 * @param {object} head
 * @returns {{segment: object, from: number, to: number}[]}
 */
export function pitchTargets(segments, head) {
  const targets = [];
  for (const phrase of intonationPhrases(segments)) {
    phrase.nuclei.forEach((segment, index) => {
      const [from, to] = syllablePitch(segment, {
        head,
        phrase,
        last: index === phrase.nuclei.length - 1,
      });
      targets.push({ segment, from, to });
    });
  }
  return targets;
}

/**
 * Loudness gain of each voiced segment from its register.
 * @param {object[]} segments
 * @returns {{segment: object, gain: number}[]}
 */
export function registerGains(segments) {
  const gains = [];
  let phraseIndex = 0;
  const phrases = intonationPhrases(segments);
  for (const segment of segments) {
    if (segment.kind === 'pause') {
      if (segment.strength >= 2 && phrases[phraseIndex]?.pause === segment) {
        phraseIndex++;
      }
      continue;
    }
    const { gain } = segmentRegister(segment, phrases[phraseIndex]);
    if (gain !== 1) {
      gains.push({ segment, gain });
    }
  }
  return gains;
}
