/**
 * Bridges from the articulation the solvers hear to the face rigs of
 * character models: ARKit blendshapes (the 52 curves MetaHuman, Ready
 * Player Me and most face trackers share), VRM 1.0 vowel expressions
 * (aa, ih, ou, ee, oh) and the 15 Oculus (Meta) Lipsync visemes.
 *
 * Each frame starts from physical measures of the same state that shapes
 * the sound: the jaw angle that opens the incisors as far as the area
 * function needs (jawAngle, G-OBIM jaw geometry), the size and roundness
 * of the lip opening with the area of the last tract section (lipOpening),
 * and where and how much the lips and the tongue constrict. Rig weights
 * follow from those measures, so a closed /m/ closes the lips, /f/ tucks
 * the lower lip under the upper incisors, /θ/ shows the tongue tip, and
 * coarticulation carries over because the state is continuous.
 */

import { normalizeHeadConfig } from '../head-config.js';
import { CHANNEL_DEFAULTS } from '../articulation/plan.js';
import { PLACES } from '../articulation/phones.js';
import { sampleState, tractShape } from '../articulation/tract-shape.js';
import { REST_GAP } from '../articulation/teeth.js';
import { jawAngle } from '../geometry/anatomy.js';
import { lipOpening } from '../geometry/lips.js';

/** The 52 ARKit blendshape names, in Apple's order. */
export const ARKIT_BLENDSHAPES = Object.freeze([
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
]);

/** VRM 1.0 lip-sync expression presets (Japanese vowels a i u e o). */
export const VRM_VISEMES = Object.freeze(['aa', 'ih', 'ou', 'ee', 'oh']);

/** Oculus (Meta) Lipsync visemes. */
export const OVR_VISEMES = Object.freeze([
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'ih',
  'oh',
  'ou',
]);

/** Formats visemeTrack() writes and the names of their weights. */
export const VISEME_FORMATS = Object.freeze({
  arkit: ARKIT_BLENDSHAPES,
  vrm: VRM_VISEMES,
  oculus: OVR_VISEMES,
});

/**
 * Largest inter-incisor opening (cm): healthy adults open 4-5 cm
 * (Gallagher et al. 2004, mean about 4.6 cm), which ARKit calls jawOpen 1.
 */
export const MAX_OPENING = 4.5;
/** Lips below this opening height (cm) count as sealed. */
const SEALED_HEIGHT = 0.1;
/** Lip opening height (cm) of a fully open funnel, as for /ɔ/. */
const FUNNEL_HEIGHT = 1;
/**
 * Share of the lip parting beyond the incisor gap taken by the lower lip
 * (as in lipsMesh), and the drop and lift (cm) the ARKit reference faces
 * show at mouthLowerDown and mouthUpperUp 1, estimated from the lips
 * baring the teeth.
 */
const LOWER_SHARE = 0.6;
const MAX_LOWER_DROP = 1.2;
const MAX_UPPER_LIFT = 1;
/** Forward push of fully rounded lips (cm), as in lipsMesh. */
const PROTRUSION = 0.6;
/**
 * Lip corners of /i/ draw back about half as far as in a full stretch, an
 * estimate from lip spreading in Fromkin (1964).
 */
const SPREAD_STRETCH = 0.5;
/**
 * The tongue tip of /θ/ sits 2-4 mm past the incisal edges, about a third
 * of tongueOut on the ARKit reference faces.
 */
const DENTAL_TONGUE_OUT = 0.3;
/** Half-width of the place windows along the tract (0 glottis, 1 lips). */
const PLACE_WIDTH = 0.012;
/** Narrower windows split the lips between bilabial and labiodental. */
const LIP_PLACE_WIDTH = 0.006;

/** Height, backness and rounding of the five vowel shapes. */
const VOWEL_SHAPES = Object.freeze({
  aa: { height: 0 },
  ee: { height: 0.6, backness: 0, rounding: 0 },
  ih: { height: 1, backness: 0, rounding: 0 },
  oh: { height: 0.6, backness: 1, rounding: 1 },
  ou: { height: 1, backness: 1, rounding: 1 },
});
/** Squared width of the vowel memberships in (height, backness, rounding). */
const VOWEL_SPREAD = 0.05;

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function placeWindow(location, centre, width = PLACE_WIDTH) {
  return Math.exp(-(((location - centre) / width) ** 2));
}

/**
 * Soft membership (summing to 1) of a vowel posture in the five vowel
 * shapes. An open vowel is aa whatever its backness; the others weigh
 * backness half as much as height and rounding.
 * @param {{height: number, backness: number, rounding: number}} state
 */
export function vowelShapes(state) {
  const height = clamp(state.height ?? 0.5);
  const backness = clamp(state.backness ?? 0.5);
  const rounding = clamp(state.rounding ?? 0);
  const raw = {};
  let total = 0;
  for (const [name, shape] of Object.entries(VOWEL_SHAPES)) {
    const distance =
      (height - shape.height) ** 2 +
      0.5 * (backness - (shape.backness ?? backness)) ** 2 +
      (rounding - (shape.rounding ?? 0)) ** 2;
    raw[name] = Math.exp(-distance / VOWEL_SPREAD);
    total += raw[name];
  }
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name, value / total])
  );
}

/** Share of a tongue constriction per place (summing to 1). */
function tonguePlaces(location) {
  const raw = {
    dental: placeWindow(location, PLACES.dental.location),
    alveolar: placeWindow(location, PLACES.alveolar.location),
    postalveolar: placeWindow(location, PLACES.postalveolar.location, 0.02),
    palatal: placeWindow(location, PLACES.palatal.location, 0.03),
    velar: smoothstep(0.78, 0.7, location),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name, value / (total || 1)])
  );
}

/**
 * Physical face measures of an articulator state: the jaw, the lips and
 * where the lips and the tongue constrict.
 * @param {Record<string, number>} state sampleState() output.
 * @param {Record<string, number>} head
 * @param {{shape?: object, maxOpening?: number}} [options] `shape` is a
 *   precomputed tractShape(state, head); `maxOpening` the gap (cm) that
 *   counts as a fully open jaw.
 */
export function faceRig(state, head, options = {}) {
  const config = normalizeHeadConfig(head);
  const full = { ...CHANNEL_DEFAULTS, ...state };
  const shape = options.shape ?? tractShape(full, config);
  const gap = shape.teeth?.gap ?? REST_GAP;
  const angle = jawAngle(gap, config);
  const rounding = clamp(full.rounding);
  const [major, minor] = lipOpening(shape.lipOpening, rounding, config);
  const lipHeight = 2 * minor;
  const lipAmount = clamp(full.lipAmount);
  const tongueAmount = clamp(full.tongueAmount);
  const location = clamp(full.tongueLocation);
  // Lips that close at the front, split between both lips and lip on
  // teeth; the rest round behind a tongue constriction (/w/, /ɥ/).
  const front = smoothstep(0.9, 0.97, location);
  const both = placeWindow(location, PLACES.bilabial.location, LIP_PLACE_WIDTH);
  const teeth = placeWindow(
    location,
    PLACES.labiodental.location,
    LIP_PLACE_WIDTH
  );
  const split = both / (both + teeth || 1);
  const bilabial = lipAmount * front * split;
  const labiodental = lipAmount * front * (1 - split);
  return {
    gap,
    jawAngle: angle,
    jawOpen: clamp(angle / jawAngle(options.maxOpening ?? MAX_OPENING, config)),
    lipWidth: 2 * major,
    lipHeight,
    lipsSealed: clamp(1 - lipHeight / SEALED_HEIGHT),
    // Lips parted beyond the incisor gap (cm) draw off the teeth.
    lipParting: Math.max(0, lipHeight - gap),
    protrusion: PROTRUSION * rounding,
    rounding,
    spread: (1 - rounding) * clamp(full.height) * (1 - clamp(full.backness)),
    bilabial,
    labiodental,
    roundedLabial: lipAmount * (1 - front),
    tongueAmount,
    tongueLocation: location,
    tongue: tonguePlaces(location),
    sibilance: clamp(full.sibilance),
    rhotic: clamp(full.rhotic),
    lateral: clamp(full.lateral),
    nasal: clamp(full.velum),
    vowel: vowelShapes(full),
    silence: 1 - smoothstep(0.05, 0.5, full.loudness),
  };
}

/**
 * ARKit blendshape weights (0..1) of a face rig; the eyes and brows stay
 * at zero and the face relaxes to rest in silence.
 * @param {ReturnType<typeof faceRig>} rig
 */
export function arkitBlendshapes(rig) {
  const weights = Object.fromEntries(
    ARKIT_BLENDSHAPES.map((name) => [name, 0])
  );
  const funnelOpen = clamp(rig.lipHeight / FUNNEL_HEIGHT);
  const stretch = SPREAD_STRETCH * rig.spread * (1 - rig.lipsSealed);
  const lower = clamp((LOWER_SHARE * rig.lipParting) / MAX_LOWER_DROP);
  const upper = clamp(((1 - LOWER_SHARE) * rig.lipParting) / MAX_UPPER_LIFT);
  const press = rig.bilabial * (1 - rig.nasal) * rig.lipsSealed;
  const mouth = {
    jawOpen: rig.jawOpen,
    // ARKit closes the lips over an open jaw by up to jawOpen.
    mouthClose: rig.jawOpen * rig.lipsSealed,
    mouthFunnel: rig.rounding * funnelOpen,
    mouthPucker: rig.rounding * (1 - funnelOpen),
    mouthStretchLeft: stretch,
    mouthStretchRight: stretch,
    mouthRollLower: rig.labiodental,
    mouthPressLeft: 0.5 * press,
    mouthPressRight: 0.5 * press,
    mouthLowerDownLeft: lower,
    mouthLowerDownRight: lower,
    mouthUpperUpLeft: upper,
    mouthUpperUpRight: upper,
    tongueOut: DENTAL_TONGUE_OUT * rig.tongueAmount * rig.tongue.dental,
  };
  const speech = 1 - rig.silence;
  for (const [name, value] of Object.entries(mouth)) {
    weights[name] = value * speech;
  }
  return weights;
}

/** Consonant viseme weights of a rig before normalisation. */
function consonantVisemes(rig) {
  const tongue = rig.tongueAmount * (1 - rig.roundedLabial);
  const { dental, alveolar, postalveolar, velar } = rig.tongue;
  const ridge = alveolar + postalveolar;
  const sonorant = Math.max(rig.nasal, rig.lateral) * (1 - rig.sibilance);
  const plain = (1 - rig.sibilance) * (1 - rig.rhotic) * (1 - sonorant);
  return {
    PP: rig.bilabial,
    FF: rig.labiodental,
    TH: tongue * dental,
    DD: tongue * alveolar * plain,
    kk: tongue * velar,
    CH: tongue * postalveolar * Math.max(rig.sibilance, plain),
    SS: tongue * alveolar * rig.sibilance,
    nn: tongue * ridge * sonorant * (1 - rig.rhotic),
    RR: tongue * ridge * rig.rhotic * (1 - rig.sibilance),
  };
}

/**
 * Oculus viseme weights of a face rig, summing to 1: silence, then the
 * consonant constrictions, then the vowel posture for the rest. A palatal
 * glide such as /j/ shapes the mouth like /i/.
 * @param {ReturnType<typeof faceRig>} rig
 */
export function ovrVisemes(rig) {
  const speech = 1 - rig.silence;
  const consonants = consonantVisemes(rig);
  const sum = Object.values(consonants).reduce((total, value) => total + value);
  const scale = speech / Math.max(1, sum);
  const vowelShare = speech - Math.min(1, sum) * speech;
  const palatal = rig.tongueAmount * rig.tongue.palatal;
  const vowels = {
    aa: rig.vowel.aa,
    E: rig.vowel.ee,
    ih: rig.vowel.ih + palatal,
    oh: rig.vowel.oh,
    ou: rig.vowel.ou,
  };
  const vowelSum = Object.values(vowels).reduce(
    (total, value) => total + value
  );
  const weights = { sil: rig.silence };
  for (const name of OVR_VISEMES.slice(1)) {
    weights[name] =
      name in consonants
        ? consonants[name] * scale
        : (vowels[name] / vowelSum) * vowelShare;
  }
  return weights;
}

/**
 * VRM vowel expression weights of a face rig. A VRM face has no consonant
 * shapes, so the vowel posture shows wherever the lips are apart and
 * fades out as they seal (/p b m f v/) or in silence.
 * @param {ReturnType<typeof faceRig>} rig
 */
export function vrmExpressions(rig) {
  const open = (1 - rig.lipsSealed) * (1 - rig.silence);
  const palatal = rig.tongueAmount * rig.tongue.palatal;
  const ih = rig.vowel.ih + palatal;
  const total = 1 + palatal;
  return {
    aa: (open * rig.vowel.aa) / total,
    ih: (open * ih) / total,
    ou: (open * rig.vowel.ou) / total,
    ee: (open * rig.vowel.ee) / total,
    oh: (open * rig.vowel.oh) / total,
  };
}

const FORMAT_WEIGHTS = {
  arkit: arkitBlendshapes,
  vrm: vrmExpressions,
  oculus: ovrVisemes,
};

/**
 * Weights of one format for a face rig.
 * @param {ReturnType<typeof faceRig>} rig
 * @param {'arkit' | 'vrm' | 'oculus'} format
 */
export function rigWeights(rig, format) {
  const weigh = FORMAT_WEIGHTS[format];
  if (!weigh) {
    throw new Error(
      `Unknown viseme format "${format}" (${Object.keys(FORMAT_WEIGHTS).join(', ')})`
    );
  }
  return weigh(rig);
}

/**
 * Face animation of a planned utterance at a frame rate, in one of the
 * rig formats.
 * @param {object} plan planUtterance() output.
 * @param {Record<string, number>} head
 * @param {{fps?: number, format?: 'arkit' | 'vrm' | 'oculus', maxOpening?: number, digits?: number}} [options]
 *   `digits` rounds the weights (default 4).
 * @returns {{format: string, fps: number, duration: number, names: readonly string[], frames: {time: number, weights: Record<string, number>}[]}}
 */
export function visemeTrack(plan, head, options = {}) {
  const format = options.format ?? 'arkit';
  const names = VISEME_FORMATS[format];
  if (!names) {
    rigWeights(null, format);
  }
  const fps = options.fps ?? 60;
  if (!(fps > 0)) {
    throw new Error(`fps must be positive, got ${fps}`);
  }
  const config = normalizeHeadConfig(head);
  const factor = 10 ** (options.digits ?? 4);
  const count = Math.floor(plan.duration * fps) + 1;
  const frames = [];
  for (let index = 0; index < count; index++) {
    const time = index / fps;
    const rig = faceRig(
      sampleState(plan, Math.min(time, plan.duration)),
      config,
      {
        maxOpening: options.maxOpening,
      }
    );
    const weights = rigWeights(rig, format);
    for (const name of names) {
      weights[name] = Math.round(weights[name] * factor) / factor;
    }
    frames.push({ time: Math.round(time * 1e6) / 1e6, weights });
  }
  return { format, fps, duration: plan.duration, names, frames };
}
