#!/usr/bin/env node
/**
 * Cut the head model and the HuBMAP HRA Visible Human mouth and larynx
 * (CC BY 4.0, fetched just in time) like MRI slices and compare them: the
 * model is fitted rigidly onto the reference's teeth and palatal vault,
 * both are cut by midsagittal, parasagittal, coronal and two axial planes
 * (through the crowns and through the palate halfway up the vault), and
 * the outlines of each part are drawn over each other and measured
 * (symmetric mean nearest distance). Key point distances come from
 * src/geometry/reference-anatomy.js.
 *
 * With --atlas the male preset is compared with the BodyParts3D or
 * Z-Anatomy atlas instead (src/geometry/atlas-sources.js), read from the
 * directory that scripts/fetch-anatomy.mjs wrote: their palate is bone, cut
 * just above the vault, and BodyParts3D has no soft palate.
 *
 * Usage:
 *   node scripts/compare-hra.mjs [--out DIR] [--metrics FILE]
 *     [--atlas bodyparts3d|z-anatomy --dir DIR]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { mergeMeshes } from '../src/geometry/loft.js';
import {
  chamferDistance,
  densify,
  transformMesh,
} from '../src/geometry/align.js';
import {
  createRaster,
  drawPolylines,
  drawText,
  encodePng,
  pasteRaster,
} from '../src/geometry/render.js';
import {
  KEY_POINTS,
  compareKeyPoints,
  modelKeyPoints,
  referenceKeyPoints,
  referenceParts,
} from '../src/geometry/reference-anatomy.js';
import { axisPlane, chainSegments, sliceMesh } from '../src/geometry/slice.js';
import { presetHeadConfig } from '../src/head-config.js';
import {
  BODYPARTS3D_ATLAS,
  Z_ANATOMY_ATLAS,
} from '../src/geometry/atlas-sources.js';
import { HRA, fetchHra, loadAtlasSource } from './fetch-anatomy.mjs';

const ROOT = new globalThis.URL('..', import.meta.url).pathname;
const PANEL = 360;
/** Pixels per millimetre. */
const SCALE = 3.2;
const DENTAL = [
  'upperIncisor',
  'lowerIncisor',
  'upperFirstMolar',
  'upperSecondMolar',
  'palateVault',
];
const PARTS = Object.freeze({
  upperTeeth: [150, 120, 40],
  lowerTeeth: [110, 90, 160],
  palate: [30, 150, 60],
  velum: [230, 120, 20],
  tongue: [200, 60, 90],
});
/** Height (mm) of the crown cut above the upper first molar's cusps. */
const CROWN_CUT = 3;
const REFERENCE_GREY = [120, 120, 120];
const TEXT = [20, 20, 20];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** The model's parts in millimetres, moved onto the reference. */
function modelParts(head, transform) {
  return Object.fromEntries(
    anatomyMeshes(head, { lod: 3 }).map((part) => [
      part.name,
      transformMesh(
        {
          positions: Float64Array.from(part.positions, (v) => v * 10),
          indices: part.indices,
        },
        transform
      ),
    ])
  );
}

/** MRI-like cut planes through the reference's landmarks. */
function cuts(points) {
  const midline = points.midline;
  const molar = points.upperFirstMolar;
  const occlusal = (molar[1] + points.palateVault[1]) / 2;
  const centre = [midline, molar[1] - 10, molar[2]];
  return [
    {
      title: 'MIDSAGITTAL',
      plane: axisPlane(0, midline - 0.05),
      view: { right: [0, 0, 1], up: [0, 1, 0], center: centre },
    },
    {
      title: 'PARASAGITTAL 15 MM',
      plane: axisPlane(0, midline - 15),
      view: { right: [0, 0, 1], up: [0, 1, 0], center: centre },
    },
    {
      title: 'CORONAL AT M1',
      plane: axisPlane(2, molar[2]),
      view: {
        right: [1, 0, 0],
        up: [0, 1, 0],
        center: [midline, molar[1], molar[2]],
      },
    },
    {
      title: 'AXIAL CROWNS',
      plane: axisPlane(1, molar[1] + CROWN_CUT),
      view: {
        right: [1, 0, 0],
        up: [0, 0, 1],
        center: [midline, molar[1], molar[2] + 10],
      },
    },
    {
      title: 'AXIAL PALATE',
      plane: axisPlane(1, occlusal),
      view: {
        right: [1, 0, 0],
        up: [0, 0, 1],
        center: [midline, occlusal, molar[2] + 10],
      },
    },
  ].map((cut) => ({ ...cut, view: { ...cut.view, scale: SCALE } }));
}

/** A fetched atlas (the Visible Human Japanese male) for compareSex(). */
function atlasReference(name, directory) {
  const source = loadAtlasSource(name, directory);
  return {
    keyPoints: source.keyPoints,
    meshes: source.parts,
    title: ATLASES[name].title,
    credit: ATLASES[name].credit,
  };
}

function outlines(mesh, plane) {
  return chainSegments(sliceMesh(mesh, plane), 1e-6);
}

/** An HRA body as the parts and key points compareSex() takes. */
function hraReference(meshes) {
  const parts = referenceParts(meshes);
  return {
    keyPoints: referenceKeyPoints(parts),
    meshes: Object.fromEntries(
      Object.keys(PARTS).map((name) => [name, mergeMeshes(parts[name] ?? [])])
    ),
    title: 'HUBMAP HRA VISIBLE HUMAN',
    credit: 'HRA CC BY 4.0, HUBMAP',
  };
}

/**
 * Render one body and measure its cuts.
 * @param {string} sex Preset compared.
 * @param {{keyPoints: object, meshes: Record<string, object|undefined>,
 *   title: string, credit: string}} body
 */
function compareSex(sex, body) {
  const reference = body.keyPoints;
  const head = presetHeadConfig(sex);
  const model = modelKeyPoints(head);
  const dental = compareKeyPoints(model, reference, { fit: DENTAL });
  const all = compareKeyPoints(model, reference);
  const fitted = modelParts(head, dental.transform);
  const referenceMeshes = body.meshes;
  const sheet = createRaster(PANEL * 5, PANEL + 60);
  const distances = [];
  cuts(reference).forEach(({ title, plane, view }, column) => {
    const raster = createRaster(PANEL, PANEL);
    for (const [name, rgb] of Object.entries(PARTS)) {
      const theirs = referenceMeshes[name]
        ? outlines(referenceMeshes[name], plane)
        : [];
      const ours = outlines(fitted[name], plane);
      drawPolylines(raster, theirs, view, REFERENCE_GREY, 1);
      drawPolylines(raster, ours, view, rgb, 2);
      if (theirs.length && ours.length) {
        distances.push({
          cut: title,
          part: name,
          mm: chamferDistance(densify(theirs, 0.5), densify(ours, 0.5)),
        });
      }
    }
    drawText(raster, title, 6, 6, TEXT, 2);
    pasteRaster(sheet, raster, column * PANEL, 30);
  });
  drawText(
    sheet,
    `${sex.toUpperCase()} PRESET (COLOUR) VS ${body.title} (GREY), FITTED ON TEETH AND VAULT`,
    8,
    8,
    TEXT,
    2
  );
  drawText(
    sheet,
    `TEETH UPPER/LOWER, PALATE GREEN, VELUM ORANGE, TONGUE RED. ${body.credit}`,
    8,
    PANEL + 38,
    TEXT,
    2
  );
  return { reference, model, dental, all, distances, sheet };
}

/** A distance (mm) or a dash for a key point the reference lacks. */
function millimetres(value, digits, width) {
  return (value === undefined ? '-' : value.toFixed(digits)).padStart(width);
}

function report(sex, { dental, all, distances }) {
  const lines = [
    `${sex}: key point distance after a rigid fit (mm)`,
    `  ${'key point'.padEnd(18)}${'dental fit'.padStart(11)}${'all-point fit'.padStart(15)}`,
    ...KEY_POINTS.map(
      (name) =>
        `  ${name.padEnd(18)}${millimetres(dental.distances[name], 1, 11)}${millimetres(all.distances[name], 1, 15)}`
    ),
    `  ${'rms (fitted)'.padEnd(18)}${dental.rms.toFixed(2).padStart(11)}${all.rms.toFixed(2).padStart(15)}`,
    `${sex}: outline distance per cut and part after the dental fit (mm)`,
    ...distances.map(
      ({ cut, part, mm }) =>
        `  ${cut.padEnd(20)}${part.padEnd(12)}${mm.toFixed(2).padStart(7)}`
    ),
  ];
  return lines.join('\n');
}

const ATLASES = Object.freeze({
  bodyparts3d: {
    ...BODYPARTS3D_ATLAS,
    title: 'BODYPARTS3D',
    credit: 'BODYPARTS3D CC BY 4.0, DBCLS',
  },
  'z-anatomy': {
    ...Z_ANATOMY_ATLAS,
    title: 'Z-ANATOMY',
    credit: 'Z-ANATOMY, THIS IMAGE CC BY-SA 4.0',
  },
});

const atlas = option('atlas');
if (atlas && (!ATLASES[atlas] || !option('dir'))) {
  throw new Error(
    `--atlas takes ${Object.keys(ATLASES).join(' or ')}, with --dir`
  );
}
const prefix = atlas ?? 'hra';
const out = option('out', join(ROOT, 'docs/case-studies/issue-9/anatomy'));
const metrics = option(
  'metrics',
  join(ROOT, `docs/case-studies/issue-9/measurements/${prefix}-comparison.txt`)
);
mkdirSync(out, { recursive: true });
const credited = atlas ? ATLASES[atlas] : { ...HRA, title: HRA.name };
const sections = [
  `Head model against ${atlas ? credited.title : HRA.name}`,
  `${credited.citation}. ${credited.license}.`,
  'Produced by scripts/compare-hra.mjs.',
  '',
];
const bodies = atlas
  ? [['male', () => atlasReference(atlas, option('dir'))]]
  : ['male', 'female'].map((sex) => [
      sex,
      async () => hraReference(await fetchHra(sex)),
    ]);
for (const [sex, load] of bodies) {
  const result = compareSex(sex, await load());
  const file = join(out, `${prefix}-${sex}-slices.png`);
  writeFileSync(file, encodePng(result.sheet, deflateSync));
  console.log(file);
  sections.push(report(sex, result), '');
}
writeFileSync(metrics, sections.join('\n'));
console.log(sections.join('\n'));
