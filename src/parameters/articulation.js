/**
 * Head parameters of the group `articulation`: timing, the movement of the
 * articulators and the speaker's habitual postures (see
 * src/parameters/anatomy.js for the entry format).
 *
 * One `speed<Channel>` per channel of `ARTICULATORS` (src/articulation/
 * plan.js) and one `duration<Rule>` per rule of `DURATION_RULES`
 * (src/articulation/durations.js) are generated from the name lists below;
 * tests/head-parameters.test.js checks that the lists match.
 */

const DYNAMICS =
  'Saltzman & Munhall 1989; Birkholz et al. 2011; fitted: experiments/issue-11-fit-dynamics.mjs (issue 38)';
const DURATIONS =
  'Klatt 1979; Hunnicutt & Klatt 1987; DURATION_RULES of src/articulation/durations.js (issue 39)';
const POSTURES =
  'Laver 1980, The Phonetic Description of Voice Quality; fitted: experiments/issue-40-articulators.mjs';

/** Channels of ARTICULATORS in their order. */
export const ARTICULATOR_CHANNELS = [
  'height',
  'backness',
  'rounding',
  'rhotic',
  'palatalization',
  'lipAmount',
  'lipArea',
  'tongueAmount',
  'tongueArea',
  'tongueLocation',
  'tongueWidth',
  'velum',
  'voicing',
  'aspiration',
  'glottalClosure',
  'frication',
  'sibilance',
  'trill',
  'lateral',
  'jaw',
  'lipProtrusion',
  'larynxHeight',
  'tongueRoot',
];

/** Rules of DURATION_RULES in their order. */
export const DURATION_RULE_NAMES = [
  'clauseFinal',
  'nonPhraseFinal',
  'nonWordFinal',
  'polysyllabic',
  'nonInitialConsonant',
  'pretonic',
  'unstressedMedial',
  'unstressedOther',
  'unstressedOnset',
  'unstressedMinimum',
  'emphasis',
  'beforeVoicedFricative',
  'beforeVoicedPlosive',
  'beforeNasal',
  'beforeVoiceless',
  'openFinal',
  'vowelBeforeVowel',
  'vowelAfterVowel',
  'clusterMiddle',
  'clusterEdge',
  'aspiration',
  'tone1',
  'tone2',
  'tone3',
  'tone4',
  'tone5',
  'longVowel',
  'longConsonant',
];

/** Head key of a channel's speed or a rule's strength: `speedJaw`. */
export function suffixKey(prefix, name) {
  return prefix + name[0].toUpperCase() + name.slice(1);
}

/** `lipProtrusion` -> `lip protrusion`. */
function words(name) {
  return name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

/**
 * Measured effect of each generated entry on its test phrase
 * (experiments/issue-41-effects.mjs). The phrase is `ˈmama ˈsasa` unless
 * `ipa` says otherwise.
 */
const SPEED_EFFECTS = {};
const DURATION_EFFECTS = {};

const BASE = [
  {
    key: 'speechRate',
    label: 'Speech rate',
    unit: 'x',
    min: 0.5,
    max: 1.8,
    step: 0.01,
    default: 1,
    description: 'Multiplies phoneme durations (higher is faster).',
    source: 'Klatt 1979; Gay 1981 (rate changes the long sounds most)',
    effect: { measure: 'duration', sign: -1 },
  },
  {
    key: 'articulationSpeed',
    label: 'Articulation speed',
    unit: 'x',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1,
    description: 'How fast articulators move between targets (coarticulation).',
    source: DYNAMICS,
    effect: { measure: 'f2', sign: -1 },
  },
  {
    key: 'stressLengthening',
    label: 'Stress lengthening',
    unit: 'x',
    min: 1,
    max: 2,
    step: 0.01,
    default: 1.35,
    description: 'Duration factor of primary stressed vowels.',
    source: 'Klatt 1979 (rule 6); Lehiste 1972',
    effect: { measure: 'duration', sign: 1 },
  },
  {
    key: 'finalLengthening',
    label: 'Final lengthening',
    unit: 'x',
    min: 1,
    max: 2,
    step: 0.01,
    default: 1.4,
    description:
      'Duration factor of vowels before a full stop; weaker punctuation lengthens less.',
    source: 'Klatt 1979 (rule 2); Lehiste 1972',
    effect: { measure: 'duration', sign: 1, ipa: 'ˈmama ˈsasa.' },
  },
  {
    key: 'pauseLength',
    label: 'Pause length',
    unit: 'x',
    min: 0.3,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Scales pauses at spaces and punctuation.',
    source: 'Klatt 1979; Goldman-Eisler 1968 (pause durations)',
    effect: { measure: 'duration', sign: 1, ipa: 'ˈmama, ˈsasa.' },
  },
  {
    key: 'coarticulation',
    label: 'Coarticulation',
    unit: 'x',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1,
    description:
      'How early articulators start moving towards the next sound (factor on all leads).',
    source: DYNAMICS,
    effect: { measure: 'f2', sign: 1 },
  },
  {
    key: 'roundingLead',
    label: 'Rounding lead',
    unit: 's',
    min: 0.05,
    max: 0.25,
    step: 0.005,
    default: 0.12,
    description:
      'How long before a rounded sound the lips start to round and protrude.',
    source: 'Benguerel & Cowan 1974 (anticipatory rounding); issue 38',
    effect: { measure: 'f2', sign: -1, ipa: 'ˈmasa ˈsu' },
  },
  {
    key: 'velumLead',
    label: 'Velum lead',
    unit: 's',
    min: 0.03,
    max: 0.15,
    step: 0.005,
    default: 0.08,
    description: 'How long before a nasal sound the velum starts to lower.',
    source: 'Bell-Berti & Krakow 1991 (anticipatory nasalization); issue 38',
    effect: { measure: 'nasalLevel', sign: 1 },
  },
  {
    key: 'rateMinimum',
    label: 'Rate exponent of the minimum',
    unit: '1',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    description:
      'Exponent of the speech rate on the minimum duration of a sound: 0 keeps the minimum at any rate.',
    source: 'Gay 1981; starting value of issue 39',
    effect: { measure: 'duration', sign: -1, head: { speechRate: 1.5 } },
  },
  {
    key: 'rateStretch',
    label: 'Rate exponent of the stretch',
    unit: '1',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1.2,
    description:
      'Exponent of the speech rate on the stretchable part of a sound (above its minimum).',
    source: 'Gay 1981; starting value of issue 39',
    effect: { measure: 'duration', sign: -1, head: { speechRate: 1.5 } },
  },
  {
    key: 'jawPosture',
    label: 'Jaw posture',
    unit: 'cm',
    min: -0.2,
    max: 0.6,
    step: 0.01,
    default: 0,
    description:
      'Speaker habit added to the jaw channel: a wider gap between the incisors in every sound (negative: a closer jaw).',
    source: POSTURES,
    effect: { measure: 'f1', sign: 1 },
  },
  {
    key: 'lipPosture',
    label: 'Lip posture',
    unit: 'cm',
    min: -0.3,
    max: 0.6,
    step: 0.01,
    default: 0,
    description:
      'Speaker habit added to the lip protrusion channel: pushed-out lips lengthen the tract, negative values spread the lips (a smile).',
    source: POSTURES,
    effect: { measure: 'f2', sign: -1 },
  },
  {
    key: 'larynxPosture',
    label: 'Larynx posture',
    unit: 'cm',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0,
    description:
      'Speaker habit added to the larynx height channel: a lowered larynx (negative) lengthens the pharynx and darkens the voice.',
    source: POSTURES,
    effect: { measure: 'f2', sign: 1 },
  },
  {
    key: 'tongueRootPosture',
    label: 'Tongue root posture',
    unit: '1',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0,
    description:
      'Speaker habit added to the tongue root channel: -1 pulls the root back and narrows the pharynx, +1 pushes it forward.',
    source: POSTURES,
    effect: { measure: 'f1', sign: 1 },
  },
  {
    key: 'jawArea',
    label: 'Jaw area change',
    unit: '1/cm',
    min: 0.3,
    max: 1.5,
    step: 0.01,
    default: 0.8,
    description:
      'Change of the mouth and lip cross-sections per cm of incisor gap away from the gap the sounds ask for.',
    source: 'fitted: experiments/issue-40-articulators.mjs',
    effect: { measure: 'f1', sign: 1, head: { jawPosture: 0.4 } },
  },
  {
    key: 'tongueRootArea',
    label: 'Tongue root area change',
    unit: '1',
    min: 0.2,
    max: 0.6,
    step: 0.01,
    default: 0.4,
    description:
      'Change of the pharynx cross-sections per unit of the tongue root channel.',
    source: 'fitted: experiments/issue-40-articulators.mjs',
    effect: { measure: 'f1', sign: 1, head: { tongueRootPosture: 1 } },
  },
];

const SPEEDS = ARTICULATOR_CHANNELS.map((name) => ({
  key: suffixKey('speed', name),
  label: `Speed of ${words(name)}`,
  unit: 'x',
  min: 0.5,
  max: 2,
  step: 0.01,
  default: 1,
  description: `Speed of the ${words(name)} channel: divides its time constant and its lead, on top of the articulation speed.`,
  source: DYNAMICS,
  effect: SPEED_EFFECTS[name] ?? { measure: 'f2', sign: 0 },
}));

const RULES = DURATION_RULE_NAMES.map((name) => ({
  key: suffixKey('duration', name),
  label: `Duration rule ${words(name)}`,
  unit: 'x',
  min: 0.5,
  max: 2,
  step: 0.01,
  default: 1,
  description: `Strength of the duration rule ${words(name)}: its factor is raised to this power (an added duration is multiplied by it), so 0.5 halves the rule's effect on a log scale and 2 doubles it.`,
  source: DURATIONS,
  effect: DURATION_EFFECTS[name] ?? { measure: 'duration', sign: 0 },
}));

export const ARTICULATION_PARAMETERS = [...BASE, ...SPEEDS, ...RULES];
