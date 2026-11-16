/**
 * Head parameters of the group `expression`: the melody of the voice
 * (intonation, vibrato and the pitch effects of the vowels and the larynx;
 * see src/parameters/anatomy.js for the entry format).
 */

export const EXPRESSION_PARAMETERS = [
  {
    key: 'pitchRange',
    label: 'Intonation range',
    unit: 'st',
    min: 0.5,
    max: 8,
    step: 0.1,
    default: 3,
    description: 'Semitone range used for stress, tones and intonation.',
    source: "'t Hart, Collier & Cohen 1990, A Perceptual Study of Intonation",
    effect: { measure: 'f0Range', sign: 1 },
  },
  {
    key: 'vibrato',
    label: 'Vibrato depth',
    unit: '1',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.25,
    description:
      'Slow periodic pitch wobble that makes the voice less robotic.',
    source: 'Sundberg 1987, The Science of the Singing Voice (vibrato extent)',
    effect: { measure: 'f0Range', sign: 1 },
  },
  {
    key: 'vibratoRate',
    label: 'Vibrato rate',
    unit: 'Hz',
    min: 3,
    max: 8,
    step: 0.1,
    default: 5.2,
    description: 'Frequency of the slow periodic pitch modulation.',
    source: 'Sundberg 1987, The Science of the Singing Voice (vibrato rate)',
    effect: { measure: 'f0Range', sign: 1, head: { vibrato: 1 } },
  },
  {
    key: 'declination',
    label: 'Declination',
    unit: 'st',
    min: 0,
    max: 6,
    step: 0.1,
    default: 2,
    description: 'Pitch drop from the start to the end of a phrase.',
    source: "'t Hart, Collier & Cohen 1990 (declination of 2 to 6 semitones)",
    effect: { measure: 'f0Range', sign: 1 },
  },
  {
    key: 'accentStrength',
    label: 'Accent strength',
    unit: 'x',
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    description: 'Scales the pitch rise on stressed syllables.',
    source:
      'Pierrehumbert 1980, The Phonology and Phonetics of English Intonation',
    effect: { measure: 'f0Range', sign: 1 },
  },
  {
    key: 'intrinsicPitch',
    label: 'Intrinsic pitch',
    unit: 'st',
    min: 0,
    max: 3,
    step: 0.1,
    default: 0,
    description:
      'Pitch difference between the closest and the most open vowel (real speakers about 1.5 semitones); 0 turns it off.',
    source: 'Whalen & Levitt 1995, J Phonetics 23 (intrinsic F0 of vowels)',
    effect: { measure: 'f0', sign: -1 },
  },
  {
    key: 'larynxPitch',
    label: 'Larynx pitch coupling',
    unit: 'cm/oct',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    description:
      'How far the larynx rises per octave of pitch above the speaker pitch (and falls below it); 0 turns it off.',
    source: 'Honda et al. 1999 (larynx height and F0); issue 40',
    effect: { measure: 'f2', sign: 1 },
  },
];
