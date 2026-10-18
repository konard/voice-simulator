#!/usr/bin/env node
/**
 * Render the head model next to MRI anatomy of the Dresden Vocal Tract
 * Dataset (CC0) and measure how well they agree: shaded side, front,
 * oblique and top views of the model, of the segmented tract, and of both tracts overlaid; outlines
 * of both cut by midsagittal, coronal, axial and oblique planes; the
 * area functions; and centreline, outline and area metrics.
 *
 * Subject 1 (male) is compared with the male preset and subject 2
 * (female) with the female one, each with the measured tract length.
 * Tract surfaces come from tests/fixtures/dvtd. The dataset's
 * mandible and maxilla scans are not drawn: they are stored in their own
 * coordinate frames, not registered to the tract scans.
 *
 * Usage:
 *   node scripts/compare-anatomy.mjs [--out DIR] [--tag NAME]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, deflateSync } from 'node:zlib';
import {
  DVTD_VOWELS,
  compareWithDvtd,
  modelTract,
  outline,
} from '../src/geometry/anatomy-compare.js';
import {
  createRaster,
  drawMesh,
  drawPolylines,
  drawText,
  encodePng,
  pasteRaster,
  drawLine,
} from '../src/geometry/render.js';
import { tractAreaFunction } from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';
import { planeBasis } from '../src/geometry/tract-analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const ROOT = new globalThis.URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests/fixtures/dvtd');
const PANEL = 320;
const COLORS = Object.freeze({
  tract: [60, 110, 220],
  anatomy: [150, 150, 150],
  skin: [235, 190, 160],
  lips: [200, 90, 100],
  dvtd: [220, 60, 50],
  text: [20, 20, 20],
});
const SUBJECTS = Object.freeze({ s1: 'male', s2: 'female' });
const VIEWS = Object.freeze([
  { name: 'SIDE', right: [0, 0, 1], up: [0, 1, 0] },
  { name: 'FRONT', right: [1, 0, 0], up: [0, 1, 0] },
  {
    name: 'OBLIQUE',
    right: [Math.SQRT1_2, 0, Math.SQRT1_2],
    up: [0, 1, 0],
  },
  { name: 'TOP', right: [-1, 0, 0], up: [0, 0, 1] },
]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function centreOf(points) {
  return [0, 1, 2].map(
    (axis) =>
      (Math.min(...points.map((point) => point[axis])) +
        Math.max(...points.map((point) => point[axis]))) /
      2
  );
}

function panel(title) {
  const raster = createRaster(PANEL, PANEL);
  drawText(raster, title, 6, 6, COLORS.text, 2);
  return raster;
}

function modelColor(name) {
  if (name === 'tract') {
    return COLORS.tract;
  }
  return name === 'lips' ? COLORS.lips : COLORS.anatomy;
}

function renderViews(model, comparison, label) {
  const centre = centreOf(model.centreline);
  const rows = [
    ['MODEL', (raster, view) => drawModel(raster, model, view)],
    ['MRI', (raster, view) => drawDvtd(raster, comparison.dvtd, view)],
    [
      'OVERLAY',
      (raster, view) => {
        const tract = model.meshes.find((mesh) => mesh.name === 'tract');
        drawMesh(raster, tract, view, COLORS.tract);
        drawMesh(raster, comparison.dvtd.meshes[0], view, COLORS.dvtd);
      },
    ],
  ];
  const sheet = createRaster(PANEL * VIEWS.length, PANEL * rows.length + 30);
  drawText(sheet, label, 8, 8, COLORS.text, 3);
  rows.forEach(([rowName, draw], row) => {
    VIEWS.forEach((spec, column) => {
      const raster = panel(`${rowName} ${spec.name}`);
      draw(raster, { ...spec, center: centre, scale: 12 });
      pasteRaster(sheet, raster, column * PANEL, 30 + row * PANEL);
    });
  });
  return sheet;
}

function drawModel(raster, model, view) {
  const opaque = model.meshes.filter((mesh) => mesh.name !== 'head');
  for (const mesh of opaque) {
    drawMesh(raster, mesh, view, modelColor(mesh.name));
  }
  const skin = model.meshes.find((mesh) => mesh.name === 'head');
  drawMesh(raster, skin, view, COLORS.skin, { alpha: 0.25 });
}

function drawDvtd(raster, dvtd, view) {
  drawMesh(raster, dvtd.meshes[0], view, COLORS.dvtd);
}

function sliceView(plane) {
  if (plane.kind === 'midsagittal') {
    return { right: [0, 0, 1], up: [0, 1, 0], scale: 13 };
  }
  if (plane.kind === 'coronal') {
    return { right: [1, 0, 0], up: [0, 1, 0], scale: 26 };
  }
  if (plane.kind === 'axial') {
    return { right: [-1, 0, 0], up: [0, 0, 1], scale: 26 };
  }
  const [right, up] = planeBasis(plane.normal);
  return { right, up, scale: 26 };
}

function renderSlice(model, comparison, plane) {
  const raster = panel(plane.name.toUpperCase());
  const view = { ...sliceView(plane), center: plane.point };
  if (plane.kind === 'midsagittal') {
    view.center = centreOf(model.centreline);
  }
  for (const mesh of model.meshes) {
    if (mesh.name !== 'tract') {
      drawPolylines(raster, outline(mesh, plane), view, COLORS.anatomy, 1);
    }
  }
  const tract = model.meshes.find((mesh) => mesh.name === 'tract');
  drawPolylines(raster, outline(tract, plane), view, COLORS.tract, 2);
  drawPolylines(
    raster,
    outline(comparison.dvtd.meshes[0], plane),
    view,
    COLORS.dvtd,
    2
  );
  const distance =
    plane.distance === null ? 'NO OVERLAP' : `D ${plane.distance.toFixed(2)}`;
  drawText(raster, distance, 6, PANEL - 22, COLORS.text, 2);
  return raster;
}

function renderAreas(model, comparison) {
  const raster = panel('AREA CM2 / GLOTTIS-LIPS');
  const series = [
    [model.shape.areas, COLORS.tract],
    [comparison.dvtd.areas, COLORS.dvtd],
  ];
  const top = Math.max(8, ...series.flatMap(([areas]) => Array.from(areas)));
  const toPixel = (fraction, area) => [
    20 + fraction * (PANEL - 40),
    PANEL - 30 - (area / top) * (PANEL - 70),
  ];
  drawLine(raster, toPixel(0, 0), toPixel(1, 0), COLORS.anatomy, 1);
  for (const [areas, rgb] of series) {
    for (let index = 1; index < areas.length; index++) {
      drawLine(
        raster,
        toPixel((index - 1) / (areas.length - 1), areas[index - 1]),
        toPixel(index / (areas.length - 1), areas[index]),
        rgb,
        2
      );
    }
  }
  drawText(raster, `MAX ${top.toFixed(1)}`, 6, 30, COLORS.text, 2);
  return raster;
}

function renderSlices(model, comparison, label) {
  const panels = [
    ...comparison.planes.map((plane) => renderSlice(model, comparison, plane)),
    renderAreas(model, comparison),
  ];
  const columns = 5;
  const rows = Math.ceil(panels.length / columns);
  const sheet = createRaster(PANEL * columns, PANEL * rows + 30);
  drawText(
    sheet,
    `${label}  BLUE MODEL TRACT, GREY MODEL ANATOMY, RED MRI TRACT, D = CM`,
    8,
    8,
    COLORS.text,
    2
  );
  panels.forEach((raster, index) =>
    pasteRaster(
      sheet,
      raster,
      (index % columns) * PANEL,
      30 + Math.floor(index / columns) * PANEL
    )
  );
  return sheet;
}

function metricsTable(results) {
  const planes = Object.keys(results[0].metrics.outlineDistance);
  const format = (value) => (value === null ? '–' : value.toFixed(2));
  const lines = [
    `| Tract | Length model / MRI (cm) | Centreline RMS (cm) | Area log-RMS | ${planes
      .map((name) => `${name} (cm)`)
      .join(' | ')} |`,
    `|${' --- |'.repeat(4 + planes.length)}`,
  ];
  for (const { name, metrics } of results) {
    lines.push(
      `| ${name} | ${metrics.modelLength.toFixed(2)} / ${metrics.dvtdLength.toFixed(2)} | ` +
        `${format(metrics.centrelineRms)} | ${format(metrics.areaLogRms)} | ${planes
          .map((plane) => format(metrics.outlineDistance[plane]))
          .join(' | ')} |`
    );
  }
  return lines.join('\n');
}

function main() {
  const out = option('--out', join(ROOT, 'docs/case-studies/issue-9/anatomy'));
  const tag = option('--tag', 'current');
  mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json')));
  const results = [];
  for (const entry of manifest.files) {
    const [subject, , ...rest] = entry.file.split('-');
    const sound = rest.join('-').replace('-inner-surface.stl.gz', '');
    const tract = parseStl(
      gunzipSync(readFileSync(join(FIXTURES, entry.file)))
    );
    const measured = tractAreaFunction(tract);
    const model = modelTract(
      presetHeadConfig(SUBJECTS[subject]),
      DVTD_VOWELS[sound],
      { length: measured.length / 10 }
    );
    const comparison = compareWithDvtd(model, tract, { measured });
    const name = `${subject}-${sound}`;
    const label = `${name.toUpperCase()} ${SUBJECTS[subject].toUpperCase()} ${tag.toUpperCase()}`;
    writeFileSync(
      join(out, `${tag}-${name}-views.png`),
      encodePng(renderViews(model, comparison, label), deflateSync)
    );
    writeFileSync(
      join(out, `${tag}-${name}-slices.png`),
      encodePng(renderSlices(model, comparison, label), deflateSync)
    );
    results.push({ name, metrics: comparison.metrics });
    console.log(name, JSON.stringify(comparison.metrics));
  }
  writeFileSync(
    join(out, `${tag}-metrics.json`),
    `${JSON.stringify(results, null, 2)}\n`
  );
  writeFileSync(join(out, `${tag}-metrics.md`), `${metricsTable(results)}\n`);
}

main();
