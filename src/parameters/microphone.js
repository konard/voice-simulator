/**
 * Head parameters of the group `microphone`: where the sound is heard and
 * how loud it is recorded (see src/parameters/anatomy.js for the entry
 * format). The `synthesize()` options `microphone` and `room` win over
 * these values.
 */

const MICROPHONE =
  'Monson et al. 2012, Front Psychol 3:400 (directivity of speech); Chu & Warnock 2002 (speech directivity)';
const ROOM =
  'Allen & Berkley 1979, JASA 65(4) (image method); Jot & Chaigne 1991 (feedback delay network)';
const ROOM_EFFECT = { measure: 'reverb', sign: 1, head: { roomRt60: 0.8 } };

export const MICROPHONE_PARAMETERS = [
  {
    key: 'outputGain',
    label: 'Output level',
    unit: 'x',
    min: 0.25,
    max: 4,
    step: 0.01,
    default: 1,
    description:
      'Gain before the soft limiter; high values saturate like a loud voice.',
    source: 'Fant 1960 (output level is linear in the source); tanh limiter',
    effect: { measure: 'rms', sign: 1 },
  },
  {
    key: 'micDistance',
    label: 'Microphone distance',
    unit: 'cm',
    min: 1,
    max: 1000,
    step: 1,
    default: 3,
    description:
      'Distance of the microphone from the lips: farther is quieter and, with a room, more reverberant (3 cm keeps the plain lip output).',
    source: MICROPHONE,
    effect: { measure: 'rms', sign: -1 },
  },
  {
    key: 'micAzimuth',
    label: 'Microphone azimuth',
    unit: '°',
    min: -180,
    max: 180,
    step: 1,
    default: 0,
    description:
      'Horizontal angle of the microphone from straight ahead: behind the head the high frequencies drop.',
    source: MICROPHONE,
    effect: { measure: 'centroid', sign: 0 },
  },
  {
    key: 'micElevation',
    label: 'Microphone elevation',
    unit: '°',
    min: -90,
    max: 90,
    step: 1,
    default: 0,
    description: 'Vertical angle of the microphone above the mouth axis.',
    source: MICROPHONE,
    effect: { measure: 'centroid', sign: 0 },
  },
  {
    key: 'roomWidth',
    label: 'Room width',
    unit: 'm',
    min: 1,
    max: 40,
    step: 0.1,
    default: 4,
    description:
      'Width of the room (used when the reverberation time is above 0).',
    source: ROOM,
    effect: ROOM_EFFECT,
  },
  {
    key: 'roomHeight',
    label: 'Room height',
    unit: 'm',
    min: 2,
    max: 30,
    step: 0.1,
    default: 2.6,
    description:
      'Height of the room (used when the reverberation time is above 0).',
    source: ROOM,
    effect: ROOM_EFFECT,
  },
  {
    key: 'roomDepth',
    label: 'Room depth',
    unit: 'm',
    min: 1,
    max: 80,
    step: 0.1,
    default: 3.5,
    description:
      'Depth of the room (used when the reverberation time is above 0).',
    source: ROOM,
    effect: ROOM_EFFECT,
  },
  {
    key: 'roomRt60',
    label: 'Reverberation time',
    unit: 's',
    min: 0,
    max: 5,
    step: 0.01,
    default: 0,
    description:
      'Time for the reverberation to fall by 60 dB; 0 renders without a room.',
    source: 'Sabine 1922; Allen & Berkley 1979 (image method)',
    effect: { measure: 'reverb', sign: 1 },
  },
];
