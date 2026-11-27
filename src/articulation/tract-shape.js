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
import { LIP_PROTRUSION, VOWEL_SECTIONS, vowelShape } from './vowel-space.js';

export { LIP_PROTRUSION };

export const TRACT_SECTIONS = VOWEL_SECTIONS;
export const NOSE_SECTIONS = 28;

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
export function referenceShape(state, corrections, jaw) {
  const base = vowelShape(
    {
      height: state.height,
      backness: state.backness,
      rounded: Math.max(0, Math.min(1, state.rounding)),
    },
    corrections
  );
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

/**
 * Warp a reference shape onto a head and resample it.
 * @param {{areas: Float64Array, length: number}} shape
 * @param {Record<string, number>} head Normalised head config.
 * @param {{sections?: number, openness?: number}} [options]
 */
export function fitToHead(shape, head, options = {}) {
  const sections = options.sections ?? TRACT_SECTIONS;
  const openness = options.openness ?? 0.5;
  const areas = new Float64Array(sections);
  for (let index = 0; index < sections; index++) {
    const x = index / (sections - 1);
    const area = sampleLinear(shape.areas, warpPosition(x, head.pharynxRatio));
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
  const count = areas.length;
  let length = 0;
  for (let index = 0; index < count; index++) {
    length += lengths[index];
  }
  const result = new Float64Array(sections);
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
function stretchedLengths(count, length, larynx, lips) {
  const step = length / count;
  const larynxRegion = Math.min(LARYNX_REGION, length);
  const lipRegion = Math.min(LIP_REGION, length);
  const lengths = new Float64Array(count);
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

function fricationSource(areas, state, head, teeth, place) {
  const index = constrictionIndex(areas, state, head, place);
  const obstacle = obstacleStrength(state, teeth);
  // Sibilant jets hit the incisors: the noise starts just past them.
  const target = obstacle > 0.5 ? Math.max(index + 1, teeth.outlet) : index + 1;
  return {
    index,
    position: Math.min(areas.length - 1, target),
    area: areas[index],
    // The plan's frication gain; the renderer scales it by the source
    // strength of the air flow (src/acoustics/aerodynamics.js).
    gain: Math.max(0, state.frication ?? 0),
    sibilance: state.sibilance ?? 0,
    obstacle,
  };
}

function applyTeeth(areas, state, head, length) {
  const teeth = dentition(state, head, length);
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
export function articulatorState(state, head, full = null) {
  full ??= { ...CHANNEL_DEFAULTS, ...state };
  const expectedJaw = impliedGap(full, head);
  const rounding = Math.max(0, Math.min(1, full.rounding));
  const expectedProtrusion = rounding * LIP_PROTRUSION;
  return {
    jaw: Math.max(0, (state.jaw ?? expectedJaw) + (head.jawPosture ?? 0)),
    expectedJaw,
    lipProtrusion:
      (state.lipProtrusion ?? expectedProtrusion) + (head.lipPosture ?? 0),
    expectedProtrusion,
    larynxHeight: (state.larynxHeight ?? 0) + (head.larynxPosture ?? 0),
    tongueRoot: Math.max(
      -1,
      Math.min(1, (state.tongueRoot ?? 0) + (head.tongueRootPosture ?? 0))
    ),
  };
}

/**
 * Full tract description for one moment.
 * @param {Record<string, number>} state Articulator channels (see plan.js).
 * @param {Record<string, number>} head Normalised head config.
 * @param {{sections?: number, teeth?: boolean, vowelCorrections?: Record<string, number[]>}} [options]
 *   `teeth: false` leaves out the incisors (constriction and obstacle noise
 *   source); `vowelCorrections` overrides the vowel calibration.
 */
export function tractShape(state, head, options = {}) {
  const full = { ...CHANNEL_DEFAULTS, time: 0, ...state };
  const free = articulatorState(state, head, full);
  full.jaw = free.jaw;
  // The mouth from x = 0.55 of the head's tract on; the lower lip rides
  // on the jaw, so the lip opening follows it too. While the tongue or the
  // lips make a consonant they compensate for the jaw, as they reach their
  // target with a bite block, so the jaw acts on the vowel part only.
  const held = Math.max(
    engagement(full.tongueAmount),
    engagement(full.lipAmount)
  );
  const reference = referenceShape(full, options.vowelCorrections, {
    scale:
      1 + (jawScale(free.jaw, free.expectedJaw, head.jawArea) - 1) * (1 - held),
    from: warpPosition(JAW_START, head.pharynxRatio),
  });
  const openness = Math.max(0, Math.min(1, 1 - full.height));
  const fitted = fitToHead(reference, head, {
    sections: options.sections,
    openness,
  });
  let { areas, length } = fitted;
  const restVelum = Math.round(
    ((areas.length - 1) * head.pharynxRatio * VELUM_POSITION) /
      REFERENCE_PHARYNX
  );
  applyTongueRoot(
    areas,
    length,
    restVelum,
    free.tongueRoot,
    head.tongueRootArea
  );
  // Each change of length goes to the place of its organ; landmarks keep
  // their distance from the lips.
  const larynx = -free.larynxHeight;
  const lips = free.lipProtrusion - free.expectedProtrusion;
  let place = (index) => index;
  // The channels are Float32Array: a protrusion that follows the rounding
  // differs from rounding * LIP_PROTRUSION by about 1e-8 cm.
  if (
    Math.abs(larynx) > MIN_LENGTH_CHANGE ||
    Math.abs(lips) > MIN_LENGTH_CHANGE
  ) {
    const lengths = stretchedLengths(areas.length, length, larynx, lips);
    const stretched = stretchSections(areas, lengths, areas.length);
    place = landmarkMap(lengths, length, stretched.length);
    ({ areas, length } = stretched);
  }
  const teeth =
    options.teeth === false ? null : applyTeeth(areas, full, head, length);
  return {
    areas,
    length,
    velumArea:
      MAX_VELUM_AREA *
      Math.max(0, Math.min(1, full.velum)) *
      (head.nasalCoupling ?? 1),
    velumIndex: place(restVelum),
    frication: fricationSource(areas, full, head, teeth, place),
    glottis: {
      f0: full.f0,
      voicing: full.voicing,
      aspiration: full.aspiration,
      closure: full.glottalClosure,
      loudness: full.loudness,
      lungPressure: full.lungPressure,
      adduction: full.adduction,
      foldTension: full.foldTension,
      effort: full.effort ?? 0,
      tension: full.tension ?? 0,
      breath: full.breath ?? 0,
      creak: full.creak ?? 0,
      falsetto: full.falsetto ?? 0,
      harsh: full.harsh ?? 0,
      whisper: full.whisper ?? 0,
    },
    lipOpening: areas.at(-1),
    jaw: openness,
    /**
     * The free articulators with the head's postures (articulatorState()):
     * incisor gap, lip protrusion and larynx height in cm, tongue root.
     */
    articulators: {
      jaw: free.jaw,
      lipProtrusion: free.lipProtrusion,
      larynxHeight: free.larynxHeight,
      tongueRoot: free.tongueRoot,
    },
    teeth,
    /**
     * Lateral channel (0..1): at 1 the tongue blocks the middle of the
     * tract at the constriction and the air passes beside it ([l]); only
     * the 2D sheet (sheet-model.js) has a width to show that.
     */
    lateral: Math.max(0, Math.min(1, full.lateral ?? 0)),
  };
}
