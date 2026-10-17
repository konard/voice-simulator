/**
 * Listening settings of the app (microphone, room, box around the head) and
 * their translation into the synthesize options. The defaults leave every
 * option out, so the default sound is the same as without the settings.
 */

import {
  AUDIO_TIERS,
  MAX_ENCLOSURE_CELLS,
  MICROPHONE_REFERENCE,
  enclosureBounds,
} from '../../../../src/index.js';

export const DEFAULT_ACOUSTICS = Object.freeze({
  micDistance: MICROPHONE_REFERENCE,
  micAzimuth: 0,
  micElevation: 0,
  micCompensate: false,
  room: 'anechoic',
  box: false,
  // Contains the default head (about 15 x 35 x 22 cm) with a few cm to spare.
  boxWidth: 30,
  boxHeight: 44,
  boxDepth: 30,
  boxAbsorption: 0.2,
});

/**
 * synthesize / speak options for the listening settings.
 * @param {typeof DEFAULT_ACOUSTICS} acoustics
 * @returns {{microphone?: object, room?: string, enclosure?: object}}
 */
export function listeningSettings(acoustics) {
  const result = {};
  const moved =
    acoustics.micDistance !== MICROPHONE_REFERENCE ||
    acoustics.micAzimuth !== 0 ||
    acoustics.micElevation !== 0 ||
    acoustics.micCompensate;
  if (moved) {
    result.microphone = {
      distance: acoustics.micDistance,
      azimuth: acoustics.micAzimuth,
      elevation: acoustics.micElevation,
      compensate: acoustics.micCompensate,
    };
  }
  if (acoustics.room !== 'anechoic') {
    result.room = acoustics.room;
  }
  if (acoustics.box) {
    result.enclosure = {
      width: acoustics.boxWidth,
      height: acoustics.boxHeight,
      depth: acoustics.boxDepth,
      absorption: acoustics.boxAbsorption,
    };
  }
  return result;
}

/** Voxel cells the box needs at a cell size (cm). */
export function enclosureCells(acoustics, dx) {
  return [acoustics.boxWidth, acoustics.boxHeight, acoustics.boxDepth].reduce(
    (product, size) => product * Math.ceil(size / dx),
    1
  );
}

/**
 * Why the box cannot be simulated for a head, or null if it can: the box
 * must contain the lips and nostrils, and the 3D tiers whose cell size makes
 * it too large fail (the worker reports an error on those tiers).
 * @param {typeof DEFAULT_ACOUSTICS} acoustics
 * @param {object} head Head configuration.
 * @returns {{message?: string, tiers?: string[]}|null}
 */
export function boxProblem(acoustics, head) {
  const { enclosure } = listeningSettings(acoustics);
  if (!enclosure) {
    return null;
  }
  try {
    enclosureBounds(head, enclosure);
  } catch (error) {
    return { message: error.message };
  }
  const tiers = AUDIO_TIERS.filter(
    (tier) =>
      tier.solver === 'fdtd3d' &&
      enclosureCells(acoustics, tier.dx) > MAX_ENCLOSURE_CELLS
  ).map((tier) => tier.name);
  return tiers.length > 0 ? { tiers } : null;
}
