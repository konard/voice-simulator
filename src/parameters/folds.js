/**
 * Head parameters of the group `folds`: the vocal folds and the shape of
 * their pulses (see src/parameters/anatomy.js for the entry format).
 */

const FOLD_SOURCE = { ipa: 'ˈa', options: { source: 'folds' } };

export const FOLDS_PARAMETERS = [
  {
    key: 'pitch',
    label: 'Base pitch',
    unit: 'Hz',
    min: 60,
    max: 320,
    step: 1,
    default: 120,
    description: 'Fundamental frequency of the vocal folds at rest.',
    source:
      'Hillenbrand et al. 1995, JASA 97(5), Table I; Titze 1989, JASA 85(4)',
    effect: { measure: 'f0', sign: 1 },
  },
  {
    key: 'tenseness',
    label: 'Vocal fold tenseness',
    unit: '1',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
    description: 'Pressed (1) versus lax and breathy (0) glottal pulses.',
    source: 'Fant, Liljencrants & Lin 1985 (LF model); Fant 1995 (Rd)',
    effect: { measure: 'h1h2', sign: -1 },
  },
  {
    key: 'breathiness',
    label: 'Breathiness',
    unit: '1',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.2,
    description:
      'Breathy voice: more aspiration noise at the glottis and a longer open phase.',
    source: 'Klatt & Klatt 1990, JASA 87(2); Hanson 1997, JASA 101(1)',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'jitter',
    label: 'Jitter',
    unit: '%',
    min: 0,
    max: 3,
    step: 0.05,
    default: 0.4,
    description: 'Random cycle-to-cycle variation of the glottal period.',
    source: 'Baken & Orlikoff 2000, Clinical Measurement of Speech and Voice',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'shimmer',
    label: 'Shimmer',
    unit: '%',
    min: 0,
    max: 15,
    step: 0.1,
    default: 3,
    description:
      'Random cycle-to-cycle variation of the glottal pulse amplitude.',
    source: 'Baken & Orlikoff 2000, Clinical Measurement of Speech and Voice',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'glottalChink',
    label: 'Glottal chink',
    unit: 'mm²',
    min: 0,
    max: 10,
    step: 0.1,
    default: 0,
    description:
      'Posterior gap left open through the glottal cycle, common in women: a darker, softer voice with wider formants.',
    source:
      'Södersten & Lindestad 1990; Hanson & Chuang 1999, JASA 106, Table X',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'foldLength',
    label: 'Vocal fold length',
    unit: 'cm',
    min: 0.6,
    max: 1.8,
    step: 0.01,
    default: 1.4,
    description:
      'Length of the vibrating vocal folds: about 1.5 cm in men, 1 cm in women and 0.7 cm in children (fold source only).',
    source: 'Titze 1989, JASA 85(4) (issue 33)',
    effect: { measure: 'rms', sign: 1, ...FOLD_SOURCE },
  },
  {
    key: 'foldMass',
    label: 'Vocal fold mass',
    unit: 'x',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1,
    description:
      'Scales the vibrating mass of the folds: heavier folds vibrate slower (fold source only).',
    source: 'Ishizaka & Flanagan 1972; Steinecke & Herzel 1995 (issue 33)',
    effect: { measure: 'f0', sign: -1, ...FOLD_SOURCE },
  },
  {
    key: 'foldStiffness',
    label: 'Vocal fold stiffness',
    unit: 'x',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1,
    description:
      'Scales the stiffness and coupling of the fold masses. The pitch control holds f0, so stiffer folds swing with a smaller amplitude (fold source only).',
    source: 'Ishizaka & Flanagan 1972; Steinecke & Herzel 1995 (issue 33)',
    effect: { measure: 'rms', sign: -1, ...FOLD_SOURCE },
  },
  {
    key: 'foldDamping',
    label: 'Vocal fold damping',
    unit: 'x',
    min: 0.5,
    max: 3,
    step: 0.01,
    default: 1,
    description:
      'Scales the damping of the folds: higher values need more pressure to start (fold source only).',
    source: 'Ishizaka & Flanagan 1972; Titze 1988 (issue 33)',
    effect: { measure: 'rms', sign: -1, ...FOLD_SOURCE },
  },
  {
    key: 'glottalPressureCoefficient',
    label: 'Glottal pressure coefficient',
    unit: '1',
    min: 1,
    max: 1.4,
    step: 0.01,
    default: 1.1,
    description:
      'Pressure coefficient of the glottis: the transglottal pressure is this times rho U² / (2 a²), Bernoulli plus the exit loss (source-tract interaction only).',
    source: 'Titze 2008 (k_t = 1.1); issue 34',
    effect: {
      measure: 'rms',
      sign: -1,
      ipa: 'ˈa',
      options: { source: 'folds', interaction: true },
    },
  },
  {
    key: 'breathinessRd',
    label: 'Breathiness pulse shape',
    unit: '1',
    min: 0.5,
    max: 2.5,
    step: 0.01,
    default: 1.5,
    description:
      'Change of the LF shape parameter Rd per unit of breathiness: a breathy voice has a longer open phase and a stronger first harmonic.',
    source:
      'Klatt & Klatt 1990; Hanson 1997 (H1-H2 of breathy voices; issue 32)',
    effect: { measure: 'h1h2', sign: 1, head: { breathiness: 0.8 } },
  },
  {
    key: 'breathGain',
    label: 'Breath noise gain',
    unit: 'x',
    min: 1,
    max: 4,
    step: 0.01,
    default: 3.87,
    description:
      'Gain of the breath noise of a breathy voice: the noise is gain × breathiness ^ exponent.',
    source:
      'Klatt & Klatt 1990; fitted: experiments/issue-35-breath-tuning.mjs (issue 32)',
    effect: { measure: 'hnr', sign: -1 },
  },
  {
    key: 'breathExponent',
    label: 'Breath noise exponent',
    unit: '1',
    min: 1.5,
    max: 3,
    step: 0.01,
    default: 2.114,
    description:
      'Exponent of the breathiness in the breath noise: higher values keep a modal voice cleaner and leave a fully breathy voice alone.',
    source:
      'Klatt & Klatt 1990; fitted: experiments/issue-35-breath-tuning.mjs (issue 32)',
    effect: { measure: 'hnr', sign: 1 },
  },
];
