// Midsagittal, coronal and axial cuts of the HuBMAP reference mouth and
// larynx (Visible Human), for a first look at their frame.
// Usage: node experiments/issue-9-hra-slices.mjs <mouth.glb> <larynx.glb> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readGlbMeshes } from '../src/geometry/gltf-read.js';
import {
  createRaster,
  drawPolylines,
  drawText,
  encodePng,
  pasteRaster,
} from '../src/geometry/render.js';
import {
  axisPlane,
  chainSegments,
  meshBounds,
  sliceMesh,
} from '../src/geometry/slice.js';

const [mouthFile, larynxFile, out] = process.argv.slice(2);
const load = (file) =>
  readGlbMeshes(new Uint8Array(readFileSync(file)), { scale: 100 });
const parts = [...load(mouthFile), ...load(larynxFile)];
const color = (name) => {
  if (name.includes('teeth')) {
    return [150, 140, 110];
  }
  if (name.includes('hard_palate')) {
    return [30, 150, 60];
  }
  if (name.includes('soft_palate')) {
    return [230, 130, 20];
  }
  if (name.includes('tongue') || name.includes('papillae')) {
    return [200, 90, 100];
  }
  if (name.includes('cartilage')) {
    return [60, 110, 220];
  }
  if (name.includes('mandible')) {
    return [120, 120, 120];
  }
  if (name.includes('gingiva') || name.includes('ginviva')) {
    return [230, 160, 170];
  }
  return [190, 190, 190];
};
for (const part of parts) {
  const { min, max } = meshBounds(part);
  console.log(
    part.name.padEnd(36),
    min.map((v) => v.toFixed(2)).join(','),
    max.map((v) => v.toFixed(2)).join(',')
  );
}
const PANEL = 420;
const image = createRaster(PANEL * 3, PANEL + 30);
const cuts = [
  {
    title: 'MIDSAGITTAL X=0',
    plane: axisPlane(0, -0.05),
    view: { right: [0, 0, 1], up: [0, 1, 0], center: [0, 70, 6], scale: 30 },
  },
  {
    title: 'CORONAL Z=7',
    plane: axisPlane(2, 7),
    view: { right: [1, 0, 0], up: [0, 1, 0], center: [0, 72, 7], scale: 30 },
  },
  {
    title: 'AXIAL Y=73.5',
    plane: axisPlane(1, 73.5),
    view: { right: [1, 0, 0], up: [0, 0, 1], center: [0, 73.5, 7], scale: 30 },
  },
];
cuts.forEach(({ title, plane, view }, column) => {
  const raster = createRaster(PANEL, PANEL);
  for (const part of parts) {
    drawPolylines(
      raster,
      chainSegments(sliceMesh(part, plane), 1e-4),
      view,
      color(part.name),
      1
    );
  }
  drawText(raster, title, 6, 6, [20, 20, 20], 2);
  pasteRaster(image, raster, column * PANEL, 30);
});
drawText(
  image,
  'HUBMAP HRA VISIBLE HUMAN MALE MOUTH AND LARYNX',
  6,
  6,
  [20, 20, 20],
  3
);
writeFileSync(out, encodePng(image, deflateSync));
