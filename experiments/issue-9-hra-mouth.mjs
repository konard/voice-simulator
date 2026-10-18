#!/usr/bin/env node
// Midsagittal comparison of the procedural mouth with the Human Reference
// Atlas mouths (Visible Human male and female, CC BY 4.0): the landmarks
// of src/geometry/mouth-landmarks.js on both, the model's jaw posed to the
// atlas's incisor gap and fitted rigidly onto the atlas's landmarks, and a
// render of both slices.
//
// Usage: node experiments/issue-9-hra-mouth.mjs [--male DIR] [--female DIR]
//          [--png FILE] [--txt FILE]
//   DIR is what `node scripts/fetch-anatomy.mjs hra-male DIR` wrote; a
//   missing one is fetched into a new temporary directory.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { transformMesh } from '../src/geometry/align.js';
import {
  compareLandmarks,
  midlineOf,
  mouthLandmarks,
  mouthMeasures,
  modelMouthParts,
} from '../src/geometry/mouth-landmarks.js';
import {
  createRaster,
  drawLine,
  drawPolylines,
  drawText,
  encodePng,
  pasteRaster,
} from '../src/geometry/render.js';
import { chainSegments, sliceMesh } from '../src/geometry/slice.js';
import { presetHeadConfig } from '../src/head-config.js';
import {
  HRA_MOUTH,
  fetchAnatomy,
  hraMouthParts,
} from '../scripts/fetch-anatomy.mjs';

/** Landmarks the rigid fit uses: the bony and dental ones. */
const FIT = ['upperIncisor', 'lowerIncisor', 'staphylion', 'uvula'];
const PARTS = ['upperTeeth', 'lowerTeeth', 'palate', 'velum', 'tongue'];
const SIZE = 640;
const SCALE = 6;
/** Slice offset (mm) from the midline: through a central incisor. */
const OFFSET = 3;
const COLOURS = {
  upperTeeth: [
    [20, 20, 20],
    [220, 40, 30],
  ],
  lowerTeeth: [
    [20, 20, 20],
    [220, 40, 30],
  ],
  palate: [
    [60, 60, 140],
    [240, 140, 0],
  ],
  velum: [
    [60, 120, 60],
    [200, 0, 160],
  ],
  tongue: [
    [110, 70, 40],
    [0, 150, 220],
  ],
};

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function atlasDirectory(source, given) {
  if (given) {
    return given;
  }
  const directory = mkdtempSync(join(tmpdir(), `${source}-`));
  await fetchAnatomy(source, directory);
  return directory;
}

const round = (value) => Math.round(value * 10) / 10;
const roundAll = (record) =>
  Object.fromEntries(
    Object.entries(record).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(round) : round(value),
    ])
  );

function midsagittal(parts, midline) {
  return Object.fromEntries(
    PARTS.map((name) => [
      name,
      chainSegments(
        sliceMesh(parts[name], { normal: [1, 0, 0], offset: midline }),
        1e-3
      ),
    ])
  );
}

function panel(title, atlas, model, landmarks) {
  const raster = createRaster(SIZE, SIZE);
  // Middle of the landmarks, a little low for the tongue below them.
  const points = Object.values(landmarks);
  const centre = [0, 1, 2].map((axis) => {
    const values = points.map((point) => point[axis]);
    return (
      (Math.min(...values) + Math.max(...values)) / 2 - (axis === 1 ? 10 : 0)
    );
  });
  // Face to the left, as sagittal MRI is shown.
  const view = {
    right: [0, 0, -1],
    up: [0, 1, 0],
    center: centre,
    scale: SCALE,
  };
  for (const name of PARTS) {
    const [dark, bright] = COLOURS[name];
    drawPolylines(raster, atlas[name], view, dark, 3);
    drawPolylines(raster, model[name], view, bright, 2);
  }
  const toPixel = (point) => [
    SIZE / 2 - (point[2] - centre[2]) * SCALE,
    SIZE / 2 - (point[1] - centre[1]) * SCALE,
  ];
  for (const point of Object.values(landmarks)) {
    const [x, y] = toPixel(point);
    drawLine(raster, [x - 6, y - 6, 0], [x + 6, y + 6, 0], [0, 0, 0], 2);
    drawLine(raster, [x - 6, y + 6, 0], [x + 6, y - 6, 0], [0, 0, 0], 2);
  }
  drawText(raster, title, 10, 10, [0, 0, 0], 2);
  drawText(
    raster,
    'DARK: ATLAS   BRIGHT: MODEL   X: ATLAS LANDMARK',
    10,
    30,
    [0, 0, 0],
    2
  );
  drawText(raster, 'TEETH', 10, 50, COLOURS.upperTeeth[1], 2);
  drawText(raster, 'PALATE', 90, 50, COLOURS.palate[1], 2);
  drawText(raster, 'VELUM', 180, 50, COLOURS.velum[1], 2);
  drawText(raster, 'TONGUE', 260, 50, COLOURS.tongue[1], 2);
  drawText(raster, '10 MM', 10, SIZE - 30, [0, 0, 0], 2);
  drawLine(
    raster,
    [10, SIZE - 12, 0],
    [10 + 10 * SCALE, SIZE - 12, 0],
    [0, 0, 0],
    3
  );
  return raster;
}

const report = [];
const panels = [];
for (const [preset, source] of [
  ['male', 'hra-male'],
  ['female', 'hra-female'],
]) {
  const directory = await atlasDirectory(source, option(preset));
  const parts = hraMouthParts(directory);
  const reference = mouthLandmarks(parts);
  const referenceMeasures = mouthMeasures(reference);
  const head = presetHeadConfig(preset);
  // The jaw posed as the atlas's: the same vertical incisor gap.
  const gap = -referenceMeasures.overbite;
  const modelParts = modelMouthParts(head, { gap });
  const model = mouthLandmarks(modelParts, { midline: 0 });
  const comparison = compareLandmarks(model, reference, FIT);
  const all = compareLandmarks(model, reference);
  const fitted = Object.fromEntries(
    PARTS.map((name) => [
      name,
      transformMesh(modelParts[name], comparison.transform),
    ])
  );
  report.push(
    `${source} (${HRA_MOUTH[source].name})`,
    `  ${HRA_MOUTH[source].citation}; ${HRA_MOUTH[source].license}`,
    `  landmarks (mm, atlas frame): ${JSON.stringify(roundAll(reference))}`,
    `  measures: ${JSON.stringify(roundAll(referenceMeasures))}`,
    `model ${preset}, jaw gap ${round(gap)} mm`,
    `  measures: ${JSON.stringify(roundAll(mouthMeasures(model)))}`,
    `  fit on ${FIT.join(', ')}: rms ${round(comparison.rms)} mm`,
    `  residuals after that fit: ${JSON.stringify(roundAll(comparison.residuals))}`,
    `  fit on all landmarks: rms ${round(all.rms)} mm, ${JSON.stringify(roundAll(all.residuals))}`,
    ''
  );
  panels.push(
    panel(
      `${source.toUpperCase()} VS MODEL ${preset.toUpperCase()}`,
      midsagittal(parts, midlineOf(parts.upperTeeth) + OFFSET),
      midsagittal(fitted, OFFSET),
      reference
    )
  );
}

const image = createRaster(SIZE * panels.length, SIZE);
panels.forEach((raster, index) => pasteRaster(image, raster, index * SIZE, 0));
const text = report.join('\n');
console.log(text);
const png = option('png');
if (png) {
  writeFileSync(png, encodePng(image, deflateSync));
}
const txt = option('txt');
if (txt) {
  writeFileSync(txt, `${text}\n`);
}
