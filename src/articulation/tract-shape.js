/**
 * Articulator state + head proportions -> vocal tract area function.
 *
 * The vowel channels pick a tongue body shape from the measured vowel space
 * (Story 2008, see vowel-space.js). Consonant constrictions, secondary
 * articulations and rhoticity are then carved into it in a normalised
 * "reference" tract, and finally the reference tract is warped onto the
 * proportions of the current head (pharynx/oral ratio, widths, length).
 * The same function feeds the 1D waveguide, the 3D voxel solver and the
 * 3D mesh, so what you see is what you hear.
 */

import { CHANNEL_DEFAULTS } from './plan.js';
import { carveTeeth, dentition, impliedGap } from './teeth.js';
import {
  createVowelWorkspace,
  LIP_PROTRUSION,
  VOWEL_SECTIONS,
  vowelShape,
} from './vowel-space.js';

export { LIP_PROTRUSION };

export const TRACT_SECTIONS = VOWEL_SECTIONS;
export const NOSE_SECTIONS = 28;
let channelNames;

/** Mean length of the measured reference tracts (cm). */
const REFERENCE_LENGTH = 17.5;
/** Pharynx / oral cavity boundary in the reference tract (fraction). */
const REFERENCE_PHARYNX = 0.455;
/** Velopharyngeal port position in the reference tract (fraction). */
export const VELUM_POSITION = 0.46;
const TRILL_RATE = 26;
const MAX_VELUM_AREA = 1.6;

/**
 * Change of the mouth and lip cross-sections per cm of incisor gap away
 * from the gap the vowel and consonant channels ask for: 0.5 cm more gap
 * raises F1 of [ɛ] by 9.3 % in the waveguide (8 to 15 % asked; 1 gives
 * 11.3 %, `node experiments/issue-40-articulators.mjs`). The smaller value
 * keeps the formants of whole sentences, in which the jaw lags the tongue,
 * closer to those before the jaw had a channel.
 */
export const JAW_AREA = 0.8;
/** Start of the mouth region the jaw opens (fraction of the tract). */
const JAW_START = 0.55;
/** Length of the lip end of the tract that protrusion stretches (cm). */
export const LIP_REGION = 1.5;
/** Length of the glottis end of the tract that the larynx stretches (cm). */
export const LARYNX_REGION = 3;
/** Change of the pharynx cross-sections per unit of `tongueRoot` (0.2 to 0.6). */
export const TONGUE_ROOT_AREA = 0.4;
/** The tongue root starts this far above the glottis (cm). */
const TONGUE_ROOT_START = 2;
/** No section gets shorter than this share of its length. */
const MIN_STRETCH = 0.3;
/** Smaller changes of length (cm) leave the sections as they are. */
const MIN_LENGTH_CHANGE = 1e-5;

/** Scratch for a renderer. Frame writers can also reuse unpublished areas. */
export function createTractWorkspace({ sections, reuseAreas = false } = {}) {
  return {
    full: { ...CHANNEL_DEFAULTS, time: 0 },
    vowel: createVowelWorkspace(),
    jaw: { scale: 1, from: 0 },
    fit: { sections, openness: 0.5, ratio: undefined, positions: undefined },
    lengths: sections === undefined ? undefined : new Float64Array(sections),
    fitted: reuseAreas ? new Float64Array(sections) : undefined,
    stretched: reuseAreas ? new Float64Array(sections) : undefined,
    shape: reuseAreas ? { frication: {}, glottis: {}, articulators: {} } : null,
    free: reuseAreas ? {} : undefined,
    teeth: reuseAreas ? {} : undefined,
  };
}

/** Nasal cavity cross-sections (cm²) from velum to nostrils. */
const NOSE_PROFILE = Array.from({ length: NOSE_SECTIONS }, (_, index) => {
  const x = index / (NOSE_SECTIONS - 1);
  // Narrow port, wide turbinate region, narrowing towards the nostrils.
  const body = 0.6 + 3.8 * Math.sin(Math.PI * Math.min(1, x * 1.25)) ** 1.5;
  return x > 0.82 ? 0.9 + (1 - x) * 3 : body;
});

/**
 * Channel values at a time (linear interpolation between frames).
 * @param {{channels: Record<string, Float32Array>, frameRate: number, frameCount: number}} plan
 * @param {number} time Seconds.
 * @param {Record<string, number>} [target] Reused output object.
 */
export function sampleState(plan, time, target = {}) {
  const position = Math.max(
    0,
    Math.min(plan.frameCount - 1, time * plan.frameRate)
  );
  const index = Math.floor(position);
  const next = Math.min(plan.frameCount - 1, index + 1);
  const fraction = position - index;
  for (const name in plan.channels) {
    const values = plan.channels[name];
    target[name] = values[index] + (values[next] - values[index]) * fraction;
  }
  target.time = time;
  return target;
}

/** Narrow the tract around `location` (0 = glottis, 1 = lips). */
export function constrict(areas, location, width, area, amount) {
  if (amount <= 0) {
    return;
  }
  const last = areas.length - 1;
  const plateau = width * 0.5 + 0.5 / last;
  for (let index = 0; index <= last; index++) {
    const distance = Math.max(0, Math.abs(index / last - location) - plateau);
    const weight = amount * Math.exp(-((distance / width) ** 2));
    if (weight > 1e-3) {
      const narrowed = Math.min(areas[index], Math.max(0, area));
      areas[index] = areas[index] * (1 - weight) + narrowed * weight;
    }
  }
}

/** Palatalisation raises the tongue front, velarisation backs it. */
function applySecondary(areas, state) {
  const value = state.palatalization ?? 0;
  if (value > 0) {
    constrict(areas, 0.8, 0.07, 0.9, 0.6 * value);
  } else if (value < 0) {
    constrict(areas, 0.62, 0.07, 1.1, -0.6 * value);
  }
}

/** Bunched/retroflex /r/: palatal + pharyngeal narrowing lowers F3. */
function applyRhotic(areas, state) {
  const amount = state.rhotic ?? 0;
  if (amount > 0) {
    constrict(areas, 0.72, 0.05, 0.2, amount);
    constrict(areas, 0.3, 0.08, 0.9, amount);
  }
}

function tongueArea(state) {
  const trill = state.trill ?? 0;
  if (trill <= 0) {
    return state.tongueArea;
  }
  const flap = 0.5 + 0.5 * Math.sin(2 * Math.PI * TRILL_RATE * state.time);
  return state.tongueArea * (1 - trill) + trill * 0.35 * flap ** 2;
}

/**
 * Articulated tract in reference proportions (before head warping).
 * @param {Record<string, number>} state
 * @param {Record<string, number[]>} [corrections] See vowelShape.
 * @param {{scale: number, from: number}} [jaw] Factor on the vowel's areas
 *   from the reference position `from` to the lips (see jawScale()). The
 *   tongue and the lips still reach their constrictions, as they do when a
 *   bite block holds the jaw, so the factor comes before them.
 */
export function referenceShape(state, corrections, jaw, workspace) {
  const position = workspace?.position ?? {
    height: 0,
    backness: 0,
    rounded: 0,
  };
  position.height = state.height;
  position.backness = state.backness;
  position.rounded = Math.max(0, Math.min(1, state.rounding));
  const base = vowelShape(position, corrections, workspace);
  const { areas } = base;
  if (jaw && jaw.scale !== 1) {
    const last = areas.length - 1;
    for (let index = 0; index <= last; index++) {
      areas[index] *= index / last > jaw.from ? jaw.scale : 1;
    }
  }
  applySecondary(areas, state);
  applyRhotic(areas, state);
  constrict(
    areas,
    state.tongueLocation,
    state.tongueWidth,
    tongueArea(state),
    engagement(state.tongueAmount)
  );
  constrict(areas, 1, 0.035, state.lipArea, engagement(state.lipAmount));
  return base;
}

/** Smoothed articulator engagement saturates, so closures really close. */
function engagement(amount) {
  return Math.min(1, Math.max(0, amount) / 0.85);
}

/** Inverse of warpPosition: reference position -> head position. */
function headPosition(reference, pharynxRatio) {
  return reference < REFERENCE_PHARYNX
    ? (reference / REFERENCE_PHARYNX) * pharynxRatio
    : pharynxRatio +
        ((reference - REFERENCE_PHARYNX) / (1 - REFERENCE_PHARYNX)) *
          (1 - pharynxRatio);
}

function warpPosition(x, pharynxRatio) {
  return x < pharynxRatio
    ? (x / pharynxRatio) * REFERENCE_PHARYNX
    : REFERENCE_PHARYNX +
        ((x - pharynxRatio) / (1 - pharynxRatio)) * (1 - REFERENCE_PHARYNX);
}

function sampleLinear(values, position) {
  const scaled = position * (values.length - 1);
  const index = Math.min(values.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  return values[index] * (1 - fraction) + values[index + 1] * fraction;
}

function regionScale(x, head, openness) {
  const blend = Math.min(1, Math.max(0, (x - head.pharynxRatio) / 0.08 + 0.5));
  let scale = head.pharynxWidth * (1 - blend) + head.oralWidth * blend;
  if (x > 0.55 && x < 0.95) {
    scale /= head.tongueSize ** 2;
    scale *= 1 + (head.jawRange - 1) * openness * 0.9;
  }
  if (x > 0.93) {
    scale *= head.mouthWidth;
  }
  return scale;
}

function prepareWarpedSamples(sections, ratio, fit) {
  if (fit.positions?.length === sections && Object.is(fit.ratio, ratio)) {
    return;
  }
  const positions = new Float64Array(sections);
  for (let i = 0; i < sections; i++) {
    positions[i] = warpPosition(i / (sections - 1), ratio);
  }
  fit.positions = positions;
  fit.ratio = ratio;
}

/**
 * Warp a reference shape onto a head and resample it.
 * @param {{areas: Float64Array, length: number}} shape
 * @param {Record<string, number>} head Normalised head config.
 * @param {{sections?: number, openness?: number}} [options]
 */
export function fitToHead(shape, head, options = {}, target, positions) {
  const sections = options.sections ?? TRACT_SECTIONS;
  const openness = options.openness ?? 0.5;
  const areas = target ?? new Float64Array(sections);
  const original = shape.areas;
  const ratio = head.pharynxRatio;
  for (let index = 0; index < sections; index++) {
    const x = index / (sections - 1);
    const position = positions ? positions[index] : warpPosition(x, ratio);
    const scaled = position * (original.length - 1);
    const first = Math.min(original.length - 2, Math.floor(scaled));
    const fraction = scaled - first;
    const area =
      original[first] * (1 - fraction) + original[first + 1] * fraction;
    areas[index] = area * regionScale(x, head, openness);
  }
  const lipExtension = 0.5 * (head.lipThickness - 1);
  const length =
    (shape.length * head.vocalTractLength) / REFERENCE_LENGTH + lipExtension;
  return { areas, length };
}

/** Length of the overlap of [from, to] and [low, high]. */
function overlap(from, to, low, high) {
  return Math.max(0, Math.min(to, high) - Math.max(from, low));
}

/**
 * Sections of unequal length -> `sections` equal ones. Each new section
 * gets the mean area of the old ones over its stretch, so every stretch of
 * the tract keeps its volume.
 * @param {ArrayLike<number>} areas Cross-sections (cm²).
 * @param {ArrayLike<number>} lengths Length of each section (cm).
 * @param {number} [sections] Number of equal sections (default: as many).
 * @returns {{areas: Float64Array, length: number}} New sections and the
 *   total length (cm).
 */
export function stretchSections(areas, lengths, sections = areas.length) {
  return stretchInto(areas, lengths, sections);
}

function stretchInto(areas, lengths, sections, result) {
  const count = areas.length;
  let length = 0;
  for (let index = 0; index < count; index++) {
    length += lengths[index];
  }
  result ??= new Float64Array(sections);
  const step = length / sections;
  let index = 0;
  let start = 0;
  for (let section = 0; section < sections; section++) {
    const from = section * step;
    const to = section === sections - 1 ? length : from + step;
    while (index < count - 1 && start + lengths[index] <= from) {
      start += lengths[index];
      index++;
    }
    let volume = 0;
    let at = start;
    for (let old = index; old < count && at < to; old++) {
      const end = old === count - 1 ? Math.max(length, to) : at + lengths[old];
      volume += areas[old] * overlap(at, end, from, to);
      at = end;
    }
    result[section] = to > from ? volume / (to - from) : areas[index];
  }
  return { areas: result, length };
}

/**
 * Lengths of the sections of a tract of `length` cm after the larynx moves
 * `larynx` cm down and the lips `lips` cm forward: the first LARYNX_REGION
 * and the last LIP_REGION cm share them; no section gets shorter than
 * MIN_STRETCH of its length.
 */
function stretchedLengths(count, length, larynx, lips, target) {
  const step = length / count;
  const larynxRegion = Math.min(LARYNX_REGION, length);
  const lipRegion = Math.min(LIP_REGION, length);
  const lengths = target ?? new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const from = index * step;
    const to = from + step;
    const added =
      (larynx * overlap(from, to, 0, larynxRegion)) / larynxRegion +
      (lips * overlap(from, to, length - lipRegion, length)) / lipRegion;
    lengths[index] = Math.max(MIN_STRETCH * step, step + added);
  }
  return lengths;
}

/**
 * Where a place `position` cm above the glottis of the unstretched tract
 * lies in the stretched one (cm above its glottis).
 */
function stretchedPosition(lengths, step, position) {
  const index = Math.min(
    lengths.length - 1,
    Math.max(0, Math.floor(position / step))
  );
  let start = 0;
  for (let previous = 0; previous < index; previous++) {
    start += lengths[previous];
  }
  return start + ((position - index * step) / step) * lengths[index];
}

/**
 * Section index of a landmark of a tract with `count` sections: `place`
 * maps the index of the unstretched tract (as a position in cm above its
 * glottis, at the section middle) onto the stretched tract, so the landmark
 * keeps its distance from the lips when the larynx moves.
 */
function landmarkMap(lengths, length, stretched) {
  const count = lengths.length;
  const step = length / count;
  return (index) => {
    const position = stretchedPosition(lengths, step, (index + 0.5) * step);
    return Math.min(
      count - 1,
      Math.max(0, Math.round((position / stretched) * count - 0.5))
    );
  };
}

/**
 * Narrow (tongueRoot < 0) or widen the pharynx from TONGUE_ROOT_START to
 * the velum, by `change` (head.tongueRootArea) per unit of the channel.
 */
function applyTongueRoot(
  areas,
  length,
  velumIndex,
  amount,
  change = TONGUE_ROOT_AREA
) {
  if (amount === 0) {
    return;
  }
  const count = areas.length;
  const step = length / count;
  const top = ((velumIndex + 0.5) / count) * length;
  for (let index = 0; index < count; index++) {
    const share =
      overlap(index * step, (index + 1) * step, TONGUE_ROOT_START, top) / step;
    areas[index] *= 1 + change * amount * share;
  }
}

/**
 * Factor on the mouth cross-sections of an incisor gap `jaw` (cm) where
 * the vowel and consonant channels ask for `expected` cm, changing by
 * `change` (head.jawArea) per cm.
 */
export function jawScale(jaw, expected, change = JAW_AREA) {
  return Math.min(2, Math.max(0.3, 1 + change * (jaw - expected)));
}

/**
 * Nasal tract for a head.
 * @param {Record<string, number>} head
 * @param {number} [sections]
 */
export function noseShape(head, sections = NOSE_SECTIONS) {
  const areas = new Float64Array(sections);
  for (let index = 0; index < sections; index++) {
    areas[index] =
      sampleLinear(NOSE_PROFILE, index / (sections - 1)) * head.nasalSize;
  }
  const length =
    11.5 * (head.vocalTractLength / 16.5) * (0.9 + 0.1 * head.noseLength);
  return { areas, length };
}

/** Narrowest section near the active articulator. */
function constrictionIndex(areas, state, head, place) {
  const lips = (state.lipAmount ?? 0) > (state.tongueAmount ?? 0);
  const location = lips ? 1 : state.tongueLocation;
  const last = areas.length - 1;
  const center = place(
    Math.round(headPosition(location, head.pharynxRatio) * last)
  );
  let best = Math.min(last, center);
  for (
    let index = Math.max(1, center - 3);
    index <= Math.min(last, center + 3);
    index++
  ) {
    if (areas[index] < areas[best]) {
      best = index;
    }
  }
  return best;
}

/** How much a sibilant jet is aimed at the incisors (0..1). */
function obstacleStrength(state, teeth) {
  if (!teeth) {
    return 0;
  }
  const narrow = Math.min(1, Math.max(0, (0.8 - teeth.gap) / 0.5));
  return (state.sibilance ?? 0) * narrow;
}

function fricationSource(areas, state, head, teeth, place, target = {}) {
  const index = constrictionIndex(areas, state, head, place);
  const obstacle = obstacleStrength(state, teeth);
  // Sibilant jets hit the incisors: the noise starts just past them.
  const position =
    obstacle > 0.5 ? Math.max(index + 1, teeth.outlet) : index + 1;
  target.index = index;
  target.position = Math.min(areas.length - 1, position);
  target.area = areas[index];
  // The renderer scales the plan's gain by the strength of the air flow.
  target.gain = Math.max(0, state.frication ?? 0);
  target.sibilance = state.sibilance ?? 0;
  target.obstacle = obstacle;
  return target;
}

function applyTeeth(areas, state, head, length, target) {
  const teeth = dentition(state, head, length, target);
  const last = areas.length - 1;
  teeth.index = carveTeeth(areas, teeth, length);
  teeth.outlet = Math.min(last, Math.round((teeth.end / length) * last) + 1);
  return teeth;
}

/**
 * The four free articulators of a state with the head's postures added:
 * incisor gap `jaw` (cm), `lipProtrusion` (cm), `larynxHeight` (cm, negative
 * lowered) and `tongueRoot` (-1 back to 1 forward). A missing `jaw` or
 * `lipProtrusion` is the one the other channels imply (`expectedJaw`,
 * rounding times LIP_PROTRUSION), as the planner writes it.
 * @param {Record<string, number>} state
 * @param {Record<string, number>} head
 * @param {Record<string, number>|null} [full] The state over
 *   CHANNEL_DEFAULTS, when the caller has it already.
 */
export function articulatorState(state, head, full = null, target = {}) {
  full ??= { ...CHANNEL_DEFAULTS, ...state };
  const expectedJaw = impliedGap(full, head);
  const rounding = Math.max(0, Math.min(1, full.rounding));
  const expectedProtrusion = rounding * LIP_PROTRUSION;
  target.jaw = Math.max(0, (state.jaw ?? expectedJaw) + (head.jawPosture ?? 0));
  target.expectedJaw = expectedJaw;
  target.lipProtrusion =
    (state.lipProtrusion ?? expectedProtrusion) + (head.lipPosture ?? 0);
  target.expectedProtrusion = expectedProtrusion;
  target.larynxHeight = (state.larynxHeight ?? 0) + (head.larynxPosture ?? 0);
  target.tongueRoot = Math.max(
    -1,
    Math.min(1, (state.tongueRoot ?? 0) + (head.tongueRootPosture ?? 0))
  );
  return target;
}

function stateWithDefaults(state, full) {
  if (!full) {
    return { ...CHANNEL_DEFAULTS, time: 0, ...state };
  }
  // A sampled control block already supplies most channels. Write each
  // scratch property once, while still resetting channels missing from it.
  const enumerable = Object.prototype.propertyIsEnumerable;
  channelNames ??= Object.keys(CHANNEL_DEFAULTS);
  for (const name of channelNames) {
    full[name] = enumerable.call(state, name)
      ? state[name]
      : CHANNEL_DEFAULTS[name];
  }
  full.time = enumerable.call(state, 'time') ? state.time : 0;
  return full;
}

function warpTract(reference, head, sections, openness, free, workspace) {
  const { lengths: lengthTarget, fitted, stretched, fit } = workspace;
  if (fit) {
    fit.sections = sections;
    fit.openness = openness;
    prepareWarpedSamples(sections, head.pharynxRatio, fit);
  }
  const { areas, length } = fitToHead(
    reference,
    head,
    fit ?? { sections, openness },
    fitted?.length === sections ? fitted : undefined,
    fit?.positions
  );
  const count = areas.length;
  const velum = Math.round(
    ((count - 1) * head.pharynxRatio * VELUM_POSITION) / REFERENCE_PHARYNX
  );
  applyTongueRoot(areas, length, velum, free.tongueRoot, head.tongueRootArea);
  // Each change of length goes to the place of its organ; landmarks keep
  // their distance from the lips. With Float32 channels, a protrusion
  // that follows rounding may still differ by about 1e-8 cm.
  const larynx = -free.larynxHeight;
  const lips = free.lipProtrusion - free.expectedProtrusion;
  if (
    Math.abs(larynx) > MIN_LENGTH_CHANGE ||
    Math.abs(lips) > MIN_LENGTH_CHANGE
  ) {
    const lengths = stretchedLengths(
      count,
      length,
      larynx,
      lips,
      lengthTarget?.length === count ? lengthTarget : undefined
    );
    const equal = stretchInto(
      areas,
      lengths,
      count,
      stretched?.length === count ? stretched : undefined
    );
    return {
      ...equal,
      velum,
      place: landmarkMap(lengths, length, equal.length),
    };
  }
  return { areas, length, velum, place: (index) => index };
}

function glottisShape(state, target = {}) {
  target.f0 = state.f0;
  target.voicing = state.voicing;
  target.aspiration = state.aspiration;
  target.closure = state.glottalClosure;
  target.loudness = state.loudness;
  target.lungPressure = state.lungPressure;
  target.adduction = state.adduction;
  target.foldTension = state.foldTension;
  target.effort = state.effort ?? 0;
  target.tension = state.tension ?? 0;
  target.breath = state.breath ?? 0;
  target.creak = state.creak ?? 0;
  target.falsetto = state.falsetto ?? 0;
  target.harsh = state.harsh ?? 0;
  target.whisper = state.whisper ?? 0;
  return target;
}

function copyArticulators(free, target = {}) {
  target.jaw = free.jaw;
  target.lipProtrusion = free.lipProtrusion;
  target.larynxHeight = free.larynxHeight;
  target.tongueRoot = free.tongueRoot;
  return target;
}

/**
 * Full tract description for one moment.
 * @param {Record<string, number>} state Articulator channels (see plan.js).
 * @param {Record<string, number>} head Normalised head config.
 * @param {{sections?: number, teeth?: boolean, vowelCorrections?: Record<string, number[]>}} [options]
 *   `teeth: false` leaves out the incisors (constriction and obstacle noise
 *   source); `vowelCorrections` overrides the vowel calibration.
 */
export function tractShape(state, head, options = {}, workspace = {}) {
  const full = stateWithDefaults(state, workspace.full);
  const free = articulatorState(state, head, full, workspace.free);
  full.jaw = free.jaw;
  // The mouth from x = 0.55 of the head's tract on; the lower lip rides
  // on the jaw, so the lip opening follows it too. While the tongue or the
  // lips make a consonant they compensate for the jaw, as they reach their
  // target with a bite block, so the jaw acts on the vowel part only.
  const held = Math.max(
    engagement(full.tongueAmount),
    engagement(full.lipAmount)
  );
  const jaw = workspace.jaw ?? { scale: 1, from: 0 };
  jaw.scale =
    1 + (jawScale(free.jaw, free.expectedJaw, head.jawArea) - 1) * (1 - held);
  jaw.from = warpPosition(JAW_START, head.pharynxRatio);
  const reference = referenceShape(
    full,
    options.vowelCorrections,
    jaw,
    workspace.vowel
  );
  const openness = Math.max(0, Math.min(1, 1 - full.height));
  const { areas, length, velum, place } = warpTract(
    reference,
    head,
    options.sections ?? TRACT_SECTIONS,
    openness,
    free,
    workspace
  );
  const teeth =
    options.teeth === false
      ? null
      : applyTeeth(areas, full, head, length, workspace.teeth);
  const shape = workspace.shape ?? {};
  shape.areas = areas;
  shape.length = length;
  shape.velumArea =
    MAX_VELUM_AREA *
    Math.max(0, Math.min(1, full.velum)) *
    (head.nasalCoupling ?? 1);
  shape.velumIndex = place(velum);
  shape.frication = fricationSource(
    areas,
    full,
    head,
    teeth,
    place,
    shape.frication
  );
  shape.glottis = glottisShape(full, shape.glottis);
  shape.lipOpening = areas.at(-1);
  shape.jaw = openness;
  // Incisor gap, lip protrusion, larynx height (cm), and tongue root.
  shape.articulators = copyArticulators(free, shape.articulators);
  shape.teeth = teeth;
  // At 1 the tongue blocks the middle of the tract and air passes beside it.
  // Only the 2D sheet has a width to show the lateral channel.
  shape.lateral = Math.max(0, Math.min(1, full.lateral ?? 0));
  return shape;
}
