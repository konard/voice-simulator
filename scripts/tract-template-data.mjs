/**
 * Measure the MRI shape of the vocal tract from the CC0 tracts of the
 * Dresden Vocal Tract Dataset in tests/fixtures/dvtd, as described in
 * scripts/build-tract-template.mjs, which writes it to
 * src/geometry/tract-template.js.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DVTD_TO_HEAD, transformPoint } from '../src/geometry/align.js';
import { tractAreaFunction } from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';
import { crossSection } from '../src/geometry/tract-analysis.js';

const FIXTURES = new globalThis.URL('../tests/fixtures/dvtd/', import.meta.url);

/** Samples of the template along the remapped arc length. */
export const SAMPLES = 41;
/** Fine resampling of each measured profile. */
const FINE = 201;
/** Moving-average half width on the fine grid (2% of the length each). */
const SMOOTH = 6;
const TURN = { ...DVTD_TO_HEAD, scale: 1 };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Linear interpolation of `values` given at increasing `at`. */
function sample(at, values, x) {
  if (x <= at[0]) {
    return values[0];
  }
  for (let index = 1; index < at.length; index++) {
    if (x <= at[index]) {
      const t = (x - at[index - 1]) / (at[index] - at[index - 1]);
      return values[index - 1] + t * (values[index] - values[index - 1]);
    }
  }
  return values.at(-1);
}

function smooth(values, half) {
  return values.map((_, index) => {
    const low = Math.max(0, index - half);
    const high = Math.min(values.length - 1, index + half);
    let sum = 0;
    for (let k = low; k <= high; k++) {
      sum += values[k];
    }
    return sum / (high - low + 1);
  });
}

/** Centreline (head frame, cm) and section shapes of one tract. */
function measure(file) {
  const mesh = parseStl(
    gunzipSync(readFileSync(new globalThis.URL(file, FIXTURES)))
  );
  const result = tractAreaFunction(mesh);
  const toHead = (point) => transformPoint(point, DVTD_TO_HEAD);
  const fractions = [0];
  const points = [toHead(result.glottis)];
  const aspects = [];
  result.points.forEach((point, index) => {
    const tangent = transformPoint(result.directions[index], TURN);
    const side = [1, 0, 0];
    const depth = cross(tangent, side);
    const centre = toHead(point);
    const extent = {
      side: [Infinity, -Infinity],
      depth: [Infinity, -Infinity],
    };
    const section = crossSection(mesh, point, result.directions[index]);
    for (const outline of section.points) {
      const offset = toHead(outline).map((value, axis) => value - centre[axis]);
      for (const [key, axis] of [
        ['side', side],
        ['depth', depth],
      ]) {
        const value = dot(offset, axis) / Math.hypot(...axis);
        extent[key][0] = Math.min(extent[key][0], value);
        extent[key][1] = Math.max(extent[key][1], value);
      }
    }
    fractions.push(result.distances[index] / result.length);
    points.push(centre);
    aspects.push(
      (extent.side[1] - extent.side[0]) / (extent.depth[1] - extent.depth[0])
    );
  });
  fractions.push(1);
  points.push(toHead(result.lips));
  return {
    file,
    fractions,
    points,
    aspectFractions: fractions.slice(1, -1),
    aspects,
  };
}

/** Bend angle (degrees) on a fine uniform grid, pharynx turned vertical. */
function bendProfile(tract) {
  const grid = Array.from({ length: FINE }, (_, index) => index / (FINE - 1));
  const coordinate = (axis) =>
    smooth(
      grid.map((t) =>
        sample(
          tract.fractions,
          tract.points.map((point) => point[axis]),
          t
        )
      ),
      SMOOTH
    );
  const ys = coordinate(1);
  const zs = coordinate(2);
  const chord = Math.round(0.4 * (FINE - 1));
  const tilt = Math.atan2(zs[chord] - zs[0], ys[chord] - ys[0]);
  const angles = grid.slice(1).map((_, index) => {
    const dy = ys[index + 1] - ys[index];
    const dz = zs[index + 1] - zs[index];
    return ((Math.atan2(dz, dy) - tilt) * 180) / Math.PI;
  });
  const middles = grid.slice(1).map((t) => t - 0.5 / (FINE - 1));
  const crossing = angles.findIndex((angle, index) => index && angle >= 45);
  const before = angles[crossing - 1];
  const bend =
    middles[crossing - 1] +
    (45 - before) / (angles[crossing] - before) / (FINE - 1);
  return { middles, angles, bend };
}

/** Arc fraction for a remapped position: the bend at 0.5. */
function unmap(position, bend) {
  return position <= 0.5
    ? (position / 0.5) * bend
    : bend + ((position - 0.5) / 0.5) * (1 - bend);
}

const round = (value, digits) => Number(value.toFixed(digits));

/**
 * Bend angles, cross-section aspects (both at SAMPLES remapped positions)
 * and the 45° bend point of every tract, rounded as committed.
 */
export function tractTemplateData() {
  const manifest = JSON.parse(
    readFileSync(new globalThis.URL('manifest.json', FIXTURES))
  );
  const tracts = manifest.files.map((entry) => measure(entry.file));
  const profiles = tracts.map(bendProfile);
  const positions = Array.from(
    { length: SAMPLES },
    (_, index) => index / (SAMPLES - 1)
  );
  const schwa = tracts
    .map((tract, index) => ({ tract, profile: profiles[index] }))
    .filter(({ tract }) => tract.file.includes('schwa'));
  const angles = positions.map(
    (position) =>
      schwa.reduce(
        (sum, { profile }) =>
          sum +
          sample(
            profile.middles,
            profile.angles,
            unmap(position, profile.bend)
          ),
        0
      ) / schwa.length
  );
  const aspects = smooth(
    positions.map(
      (position) =>
        tracts.reduce(
          (sum, tract, index) =>
            sum +
            sample(
              tract.aspectFractions,
              smooth(tract.aspects, 2),
              unmap(position, profiles[index].bend)
            ),
          0
        ) / tracts.length
    ),
    1
  ).map((value) => Math.max(1, value));
  const bends = Object.fromEntries(
    tracts.map((tract, index) => [
      tract.file.replace('-inner-surface.stl.gz', ''),
      round(profiles[index].bend, 3),
    ])
  );
  return {
    bendAngles: angles.map((value) => round(value, 1)),
    aspects: aspects.map((value) => round(value, 2)),
    bendFractions: bends,
  };
}
