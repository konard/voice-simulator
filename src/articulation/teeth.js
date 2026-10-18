/**
 * Dentition shared by the area function, the 3D voxel solver and the
 * meshes: where the incisors sit along the tract and how far apart they are.
 *
 * MRI area functions (Story 2008) do not show teeth, so the incisor
 * constriction is carved in separately. Sizes follow dental anatomy: the
 * upper central incisor crown is about 10 mm long and 7 mm thick at the
 * edge level, the incisal edges sit 3-4 mm apart at rest and 1-2 mm in
 * sibilants, and the inter-incisor opening grows to about 1.2 cm for /a/.
 * The obstacle they form is the main noise source of /s z ʃ ʒ/ (Shadle
 * 1985; Howe & McGowan 2005).
 */

/** Thickness of the incisor row along the tract (cm). */
export const INCISOR_THICKNESS = 0.7;
/** Incisor gap at rest with the jaw raised (cm). */
export const REST_GAP = 0.35;
/** Incisor gap of sibilants and alveolar stops, jaw fully raised (cm). */
export const SIBILANT_GAP = 0.15;
/** Incisor gap of velar stops, which leave the jaw lower (cm). */
export const VELAR_GAP = 0.55;
/**
 * Extra incisor gap of an open vowel and of a high back one (cm, scaled
 * by head.jawRange). With the gaps above they reproduce the jaw openings
 * G-OBIM matched to MRI of sustained phonemes (Calka et al. 2025, PLOS
 * Comput Biol 21(9): e1013378, Table 3): /t/ 1, /i/ 3, /k/ 5, /u/ 7 and
 * /a/ 11 mm, each 0.5 mm below the gap here, as if measured from edges
 * 0.5 mm apart.
 */
const OPEN_GAP = 0.8;
const BACK_GAP = 0.4;

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

/** Distance (cm) from the lip opening back to the incisal edges' front. */
export function incisorDepth(head) {
  return 0.35 + 0.35 * head.lipThickness;
}

/** Width (cm) of the opening between the incisal edges. */
export function teethWidth(head) {
  return 2.6 * head.mouthWidth;
}

/**
 * Inter-incisor gap (cm) for an articulator state: the jaw follows vowel
 * openness, stays a little lower for back vowels, and rises for
 * consonants: fully for sibilants and stops made with the tongue tip, less
 * for velars, partly for the lips (which can close with the jaw lowered).
 * @param {Record<string, number>} state
 * @param {Record<string, number>} head
 */
export function teethGap(state, head) {
  const height = clamp(state.height ?? 0.5);
  const back = clamp(state.backness ?? 0.5);
  const vowelGap =
    REST_GAP +
    (OPEN_GAP * (1 - height) + BACK_GAP * back * height) * head.jawRange;
  // A consonant only ever raises the jaw towards its own gap.
  const raise = (gap, weight) =>
    gap < vowelGap ? (gap - vowelGap) * clamp(weight) : 0;
  const front = smoothstep(0.66, 0.9, state.tongueLocation ?? 0.9);
  const tongueGap = VELAR_GAP + (SIBILANT_GAP - VELAR_GAP) * front;
  return (
    vowelGap +
    Math.min(
      raise(SIBILANT_GAP, state.sibilance ?? 0),
      raise(tongueGap, (state.tongueAmount ?? 0) / 0.85),
      raise(SIBILANT_GAP, (0.4 * (state.lipAmount ?? 0)) / 0.85)
    )
  );
}

/**
 * Incisors along a tract of `length` cm: span from glottis (cm), gap and
 * the open area between the edges.
 * @param {Record<string, number>} state
 * @param {Record<string, number>} head
 * @param {number} length Tract length (cm).
 */
export function dentition(state, head, length) {
  const end = Math.max(0, length - incisorDepth(head));
  const gap = teethGap(state, head);
  return {
    gap,
    area: gap * teethWidth(head),
    start: Math.max(0, end - INCISOR_THICKNESS),
    end,
  };
}

/**
 * Narrow `areas` to the opening between the incisors. Sections partly
 * covered by the teeth are narrowed in proportion.
 * @param {Float64Array} areas
 * @param {{area: number, start: number, end: number}} teeth
 * @param {number} length
 * @returns {number} Index of the section most covered by the teeth.
 */
export function carveTeeth(areas, teeth, length) {
  const last = areas.length - 1;
  const half = 0.5 / last;
  let best = last;
  let bestCover = 0;
  for (let index = 0; index <= last; index++) {
    const x = index / last;
    const low = Math.max(x - half, teeth.start / length);
    const high = Math.min(x + half, teeth.end / length);
    const cover = clamp((high - low) / (2 * half));
    if (cover > 0) {
      const narrowed = Math.min(areas[index], teeth.area);
      areas[index] += (narrowed - areas[index]) * cover;
      if (cover > bestCover) {
        bestCover = cover;
        best = index;
      }
    }
  }
  return best;
}
