/**
 * Comparison of the head model with a segmented vocal tract: the
 * segmented tract (Dresden Vocal Tract Dataset millimetres) is turned into
 * the head frame and rigidly fitted onto the model's centreline, then both
 * are cut by the same midsagittal, coronal, axial and oblique planes and
 * measured: centreline deviation, outline distance per cut, and the area
 * function along the tract.
 */

import { tractShape } from '../articulation/tract-shape.js';
import { normalizeHeadConfig } from '../head-config.js';
import {
  DVTD_TO_HEAD,
  chamferDistance,
  composeTransforms,
  densify,
  resampleCurve,
  rigidFit,
  transformMesh,
  transformPoint,
} from './align.js';
import { tractCenterline } from './centerline.js';
import { tractAreaFunction } from './dvtd.js';
import { headModel } from './model.js';
import { chainSegments, sliceMesh } from './slice.js';

/** Vowel features (height, backness, rounding) of the dataset's sounds. */
export const DVTD_VOWELS = Object.freeze({
  'bahn-tense-a': { height: 0, backness: 1, rounding: 0 },
  'tiere-tense-i': { height: 1, backness: 0, rounding: 0 },
  'bude-tense-u': { height: 1, backness: 1, rounding: 1 },
  'ehe-schwa': { height: 0.5, backness: 0.5, rounding: 0 },
});

const CURVE_SAMPLES = 64;
const OUTLINE_STEP = 0.05;

function pathPoints(path) {
  const points = [];
  for (let index = 0; index < path.count; index++) {
    points.push(Array.from(path.points.subarray(index * 3, index * 3 + 3)));
  }
  return points;
}

/**
 * The model for a head and articulator state: meshes, tract centreline
 * and area function.
 * @param {Record<string, number>} head
 * @param {object} state
 */
export function modelTract(head, state) {
  const config = normalizeHeadConfig(head);
  const shape = tractShape(state, config);
  const path = tractCenterline(config, {
    sections: shape.areas.length,
    length: shape.length,
  });
  return {
    config,
    shape,
    centreline: pathPoints(path),
    meshes: headModel(config, { lod: 2, state }),
  };
}

/**
 * Planes through the model tract: midsagittal, coronal through the
 * pharynx, the bend and the front of the mouth, axial through the
 * pharynx and the oral cavity, and oblique cuts across the tract at a
 * quarter, half and three quarters of its length.
 * @param {number[][]} centreline Glottis to lips, head centimetres.
 */
export function comparisonPlanes(centreline) {
  const at = (fraction) =>
    resampleCurve(centreline, 101)[Math.round(fraction * 100)];
  const across = (fraction) => {
    const before = at(Math.max(0, fraction - 0.02));
    const after = at(Math.min(1, fraction + 0.02));
    const direction = after.map((value, axis) => value - before[axis]);
    const norm = Math.hypot(...direction);
    return direction.map((value) => value / norm);
  };
  const plane = (name, kind, normal, point) => ({
    name,
    kind,
    normal,
    point,
    offset: normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2],
  });
  return [
    plane('midsagittal', 'midsagittal', [1, 0, 0], at(0.5)),
    ...[0.2, 0.55, 0.85].map((fraction) =>
      plane(
        `coronal ${Math.round(fraction * 100)}%`,
        'coronal',
        [0, 0, 1],
        at(fraction)
      )
    ),
    ...[0.3, 0.8].map((fraction) =>
      plane(
        `axial ${Math.round(fraction * 100)}%`,
        'axial',
        [0, 1, 0],
        at(fraction)
      )
    ),
    ...[0.25, 0.5, 0.75].map((fraction) =>
      plane(
        `oblique ${Math.round(fraction * 100)}%`,
        'oblique',
        across(fraction),
        at(fraction)
      )
    ),
  ];
}

/** Outline of a mesh in a plane as polylines. */
export function outline(mesh, plane) {
  return chainSegments(sliceMesh(mesh, plane), 1e-6);
}

function areaAt(areas, fraction) {
  const scaled = fraction * (areas.length - 1);
  const index = Math.min(areas.length - 2, Math.floor(scaled));
  const t = scaled - index;
  return areas[index] * (1 - t) + areas[index + 1] * t;
}

/**
 * Align a segmented tract with the model and measure how far apart they
 * are.
 * @param {{config: object, shape: object, centreline: number[][], meshes: object[]}} model
 *   From modelTract().
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} tract
 *   Segmented inner surface in dataset millimetres.
 */
export function compareWithDvtd(model, tract) {
  const measured = tractAreaFunction(tract);
  const dvtdCentreline = [
    measured.glottis,
    ...measured.points,
    measured.lips,
  ].map((point) => transformPoint(point, DVTD_TO_HEAD));
  const fit = rigidFit(
    resampleCurve(dvtdCentreline, CURVE_SAMPLES),
    resampleCurve(model.centreline, CURVE_SAMPLES)
  );
  const transform = composeTransforms(DVTD_TO_HEAD, fit);
  const dvtd = {
    centreline: dvtdCentreline.map((point) => transformPoint(point, fit)),
    meshes: [{ name: 'tract', ...transformMesh(tract, transform) }],
    areas: measured.areas.map((area) => area / 100),
    length: measured.length / 10,
  };
  const modelTube = model.meshes.find((mesh) => mesh.name === 'tract');
  const planes = comparisonPlanes(model.centreline).map((plane) => {
    const ours = densify(outline(modelTube, plane), OUTLINE_STEP);
    const theirs = densify(outline(dvtd.meshes[0], plane), OUTLINE_STEP);
    return {
      ...plane,
      distance:
        ours.length && theirs.length ? chamferDistance(ours, theirs) : null,
    };
  });
  const fractions = Array.from({ length: 41 }, (_, index) => index / 40);
  const logRatios = fractions.map((fraction) =>
    Math.log(
      Math.max(1e-3, areaAt(model.shape.areas, fraction)) /
        Math.max(1e-3, areaAt(dvtd.areas, fraction))
    )
  );
  return {
    transform,
    dvtd,
    planes,
    metrics: {
      centrelineRms: fit.rms,
      modelLength: model.shape.length,
      dvtdLength: dvtd.length,
      areaLogRms: Math.sqrt(
        logRatios.reduce((sum, value) => sum + value * value, 0) /
          logRatios.length
      ),
      outlineDistance: Object.fromEntries(
        planes.map((plane) => [plane.name, plane.distance])
      ),
    },
  };
}
