// Midsagittal cut of the airway, teeth, tongue, hard palate and velum of
// the male, female and child presets, velum raised and lowered.
// Usage: node experiments/issue-9-palate-render.mjs <out.png> [title]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { headModel } from '../src/geometry/model.js';
import {
  createRaster,
  drawPolylines,
  drawText,
  encodePng,
  pasteRaster,
} from '../src/geometry/render.js';
import { axisPlane, chainSegments, sliceMesh } from '../src/geometry/slice.js';
import { presetHeadConfig } from '../src/head-config.js';

const [out, title = ''] = process.argv.slice(2);
const PANEL = 360;
const COLORS = {
  tract: [60, 110, 220],
  upperTeeth: [150, 140, 110],
  lowerTeeth: [150, 140, 110],
  tongue: [200, 90, 100],
  palate: [30, 150, 60],
  velum: [230, 130, 20],
  lips: [200, 90, 100],
};
const image = createRaster(PANEL * 3, PANEL * 2 + 30);
drawText(image, title, 6, 6, [20, 20, 20], 3);
['male', 'female', 'child'].forEach((name, column) => {
  const head = presetHeadConfig(name);
  [0, 1].forEach((velum, row) => {
    const raster = createRaster(PANEL, PANEL);
    const parts = [
      ...headModel(head, { lod: 3 }).filter((part) => part.name in COLORS),
      ...anatomyMeshes(head, { lod: 3, state: { velum } }),
    ];
    const view = {
      right: [0, 0, 1],
      up: [0, 1, 0],
      center: [0, -6, 4],
      scale: 26,
    };
    for (const part of parts) {
      const lines = chainSegments(sliceMesh(part, axisPlane(0, 0.001)));
      drawPolylines(raster, lines, view, COLORS[part.name], 2);
    }
    drawText(
      raster,
      `${name.toUpperCase()} VELUM ${velum}`,
      6,
      6,
      [20, 20, 20],
      2
    );
    pasteRaster(image, raster, column * PANEL, 30 + row * PANEL);
  });
});
writeFileSync(out, encodePng(image, deflateSync));
