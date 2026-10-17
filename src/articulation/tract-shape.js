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
import { carveTeeth, dentition } from './teeth.js';
import { VOWEL_SECTIONS, vowelShape } from './vowel-space.js';

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

/** Articulated tract in reference proportions (before head warping). */
export function referenceShape(state) {
  const base = vowelShape({
    height: state.height,
    backness: state.backness,
    rounded: Math.max(0, Math.min(1, state.rounding)),
  });
  const { areas } = base;
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
function constrictionIndex(areas, state, head) {
  const lips = (state.lipAmount ?? 0) > (state.tongueAmount ?? 0);
  const location = lips ? 1 : state.tongueLocation;
  const last = areas.length - 1;
  const center = Math.round(headPosition(location, head.pharynxRatio) * last);
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

/**
 * Turbulence efficiency of a constriction: silent when closed, strongest
 * for slit-like openings, fading as the channel gets wide.
 */
export function turbulence(area) {
  if (area <= 0.005) {
    return 0;
  }
  if (area < 0.06) {
    return (area - 0.005) / 0.055;
  }
  return Math.max(0, 1 - (area - 0.06) / 0.4) ** 2;
}

/** How much a sibilant jet is aimed at the incisors (0..1). */
function obstacleStrength(state, teeth) {
  if (!teeth) {
    return 0;
  }
  const narrow = Math.min(1, Math.max(0, (0.8 - teeth.gap) / 0.5));
  return (state.sibilance ?? 0) * narrow;
}

function fricationSource(areas, state, head, teeth) {
  const index = constrictionIndex(areas, state, head);
  const obstacle = obstacleStrength(state, teeth);
  // Sibilant jets hit the incisors: the noise starts just past them.
  const target = obstacle > 0.5 ? Math.max(index + 1, teeth.outlet) : index + 1;
  return {
    index,
    position: Math.min(areas.length - 1, target),
    area: areas[index],
    gain: (state.frication ?? 0) * turbulence(areas[index]),
    sibilance: state.sibilance ?? 0,
    obstacle,
  };
}

function applyTeeth(areas, state, head, length) {
  const teeth = dentition(state, head, length);
  const last = areas.length - 1;
  return {
    ...teeth,
    index: carveTeeth(areas, teeth, length),
    outlet: Math.min(last, Math.round((teeth.end / length) * last) + 1),
  };
}

/**
 * Full tract description for one moment.
 * @param {Record<string, number>} state Articulator channels (see plan.js).
 * @param {Record<string, number>} head Normalised head config.
 * @param {{sections?: number, teeth?: boolean}} [options] `teeth: false`
 *   leaves out the incisors (constriction and obstacle noise source).
 */
export function tractShape(state, head, options = {}) {
  const full = { ...CHANNEL_DEFAULTS, time: 0, ...state };
  const reference = referenceShape(full);
  const openness = Math.max(0, Math.min(1, 1 - full.height));
  const { areas, length } = fitToHead(reference, head, {
    sections: options.sections,
    openness,
  });
  const teeth =
    options.teeth === false ? null : applyTeeth(areas, full, head, length);
  return {
    areas,
    length,
    velumArea:
      MAX_VELUM_AREA *
      Math.max(0, Math.min(1, full.velum)) *
      (head.nasalCoupling ?? 1),
    velumIndex: Math.round(
      ((areas.length - 1) * head.pharynxRatio * VELUM_POSITION) /
        REFERENCE_PHARYNX
    ),
    frication: fricationSource(areas, full, head, teeth),
    glottis: {
      f0: full.f0,
      voicing: full.voicing,
      aspiration: full.aspiration,
      closure: full.glottalClosure,
      loudness: full.loudness,
    },
    lipOpening: areas.at(-1),
    jaw: openness,
    teeth,
  };
}
