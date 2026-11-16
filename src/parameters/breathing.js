/**
 * Head parameters of the group `breathing`: the lungs, the air flow and
 * the turbulence noise it makes (see src/parameters/anatomy.js for the
 * entry format). Issue 35 gave the ranges of the aerodynamic constants.
 */

const AERODYNAMICS = 'Stevens 1998, Acoustic Phonetics, ch. 2 (issue 35)';

export const BREATHING_PARAMETERS = [
  {
    key: 'aspirationLevel',
    label: 'Aspiration noise',
    unit: 'x',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Scales the turbulent noise generated at the glottis.',
    source: 'Klatt & Klatt 1990, JASA 87(2) (aspiration noise levels)',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'fricationLevel',
    label: 'Frication level',
    unit: 'x',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description:
      'Scales the turbulence noise at constrictions (fricatives and bursts).',
    source: 'Shadle 1985; Stevens 1998 (frication noise sources)',
    effect: { measure: 'noiseLevel', sign: 1 },
  },
  {
    key: 'lungPressure',
    label: 'Lung pressure',
    unit: 'Pa',
    min: 300,
    max: 2000,
    step: 10,
    default: 800,
    description:
      'Subglottal pressure of normal loudness: drives the air flow, the noise at constrictions and at the glottis and, with the fold source, the vocal folds.',
    source: 'Titze 1994, Principles of Voice Production (issue 33)',
    effect: { measure: 'noiseLevel', sign: 1 },
  },
  {
    key: 'oralCompliance',
    label: 'Oral compliance',
    unit: 'cm⁵/dyn',
    min: 0.0005,
    max: 0.002,
    step: 0.00001,
    default: 0.001,
    description:
      'Compliance of the walls and the air behind a constriction: sets how fast the pressure builds up in a stop (about 11 ms with an open glottis).',
    source: AERODYNAMICS,
    effect: { measure: 'noiseLevel', sign: -1, ipa: 'ˈapa ˈtata' },
  },
  {
    key: 'glottisVoiced',
    label: 'Voiced glottal area',
    unit: 'cm²',
    min: 0.03,
    max: 0.1,
    step: 0.001,
    default: 0.05,
    description:
      'Mean glottal area of modal voicing: more lets more air through and less pressure reach the constrictions.',
    source: AERODYNAMICS,
    effect: { measure: 'noiseLevel', sign: -1, ipa: 'ˈaza ˈzaza' },
  },
  {
    key: 'glottisOpen',
    label: 'Open glottal area',
    unit: 'cm²',
    min: 0.15,
    max: 0.4,
    step: 0.001,
    default: 0.25,
    description:
      'Glottal area of an open glottis in [h] and voiceless obstruents.',
    source: AERODYNAMICS,
    effect: { measure: 'noiseLevel', sign: 1 },
  },
  {
    key: 'glottisBreathy',
    label: 'Breathy glottal area',
    unit: 'cm²',
    min: 0.05,
    max: 0.2,
    step: 0.001,
    default: 0.1,
    description:
      'Extra mean glottal area of a fully breathy voice: more makes the breath noise stronger.',
    source: AERODYNAMICS,
    effect: { measure: 'hnr', sign: -1, head: { breathiness: 0.8 } },
  },
  {
    key: 'reCritical',
    label: 'Critical Reynolds number',
    unit: '1',
    min: 1700,
    max: 2300,
    step: 10,
    default: 1800,
    description:
      'Reynolds number above which a jet becomes turbulent: higher values give less noise from a weak flow.',
    source: 'Stevens 1998; Sinder 1999 (issue 35)',
    effect: { measure: 'noiseLevel', sign: -1 },
  },
  {
    key: 'wallSource',
    label: 'Wall noise source',
    unit: 'x',
    min: 0.1,
    max: 0.35,
    step: 0.01,
    default: 0.18,
    description:
      'Amplitude of the noise of the jet hitting the walls against that of the jet hitting the teeth (-15 dB).',
    source: 'Shadle 1985 (obstacle and wall sources; issue 35)',
    effect: { measure: 'noiseLevel', sign: 1, ipa: 'ˈafa ˈfafa' },
  },
  {
    key: 'strouhal',
    label: 'Strouhal number',
    unit: '1',
    min: 0.15,
    max: 0.3,
    step: 0.01,
    default: 0.2,
    description:
      'Strouhal number of the jet: the turbulence noise peaks near this times the jet velocity over its diameter.',
    source: 'Stevens 1998 (issue 35)',
    effect: { measure: 'centroid', sign: 1 },
  },
  {
    key: 'chinkNoise',
    label: 'Chink noise',
    unit: 'x',
    min: 0,
    max: 1.5,
    step: 0.01,
    default: 0.5,
    description:
      'Breath noise per 10 mm² of glottal chink: the air leaking through a gap that stays open is turbulent too.',
    source:
      'Södersten & Lindestad 1990; starting value of issue 35 (experiments/issue-11-audit-m2.mjs)',
    effect: { measure: 'hnr', sign: -1, head: { glottalChink: 5 } },
  },
  {
    key: 'fricationGain',
    label: 'Frication gain',
    unit: 'x',
    min: 0.3,
    max: 1.2,
    step: 0.001,
    default: 0.592,
    description:
      'Amplitude of the frication noise of a default voiceless fricative (relative source strength 1).',
    source: 'fitted: experiments/issue-35-frication-tuning.mjs',
    effect: { measure: 'noiseLevel', sign: 1 },
  },
  {
    key: 'transientGain',
    label: 'Burst transient gain',
    unit: 's',
    min: 0,
    max: 0.00002,
    step: 0.0000001,
    default: 0.000005,
    description:
      'Gain of the burst transient: the flow derivative at the release of a stop enters the tract as a flow source at the constriction.',
    source: 'fitted: experiments/issue-11-turbulence.mjs (issue 35)',
    effect: { measure: 'rms', sign: 1, ipa: 'ˈata ˈtata' },
  },
];
