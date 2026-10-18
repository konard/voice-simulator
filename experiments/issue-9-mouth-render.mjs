// Close-up renders of the mouth (lips, teeth, tongue, palate under a
// translucent skin) for a few vowels from the front, the side and at
// three quarters. Pass --root to render another checkout of the model,
// for example a worktree of an older commit for a before/after pair.
// Usage: node experiments/issue-9-mouth-render.mjs [--root DIR] [--out FILE] [--label TEXT]
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const ROOT = resolve(
  option('--root', new globalThis.URL('..', import.meta.url).pathname)
);
const OUT = option('--out', 'mouth.png');
const LABEL = option('--label', 'MOUTH');
const load = (path) => import(join(ROOT, 'src', path));
const { headModel } = await load('geometry/model.js');
const { headLandmarks } = await load('geometry/centerline.js');
const { vowelTarget } = await load('articulation/phones.js');
const { getPhoneme } = await load('ipa/inventory.js');
const { DEFAULT_HEAD } = await load('head-config.js');
const render = await import(
  new globalThis.URL('../src/geometry/render.js', import.meta.url)
);

const PANEL = 300;
const COLORS = {
  skin: [235, 190, 160],
  lips: [200, 90, 100],
  upperTeeth: [245, 245, 235],
  lowerTeeth: [245, 245, 235],
  tongue: [210, 120, 130],
  tract: [60, 110, 220],
};
const VIEWS = [
  { name: 'FRONT', right: [1, 0, 0], up: [0, 1, 0] },
  { name: 'SIDE', right: [0, 0, 1], up: [0, 1, 0] },
  {
    name: '3/4',
    right: [Math.SQRT1_2, 0, Math.SQRT1_2],
    up: [0, 1, 0],
  },
];
const STATES = [
  ['REST', {}],
  ...[
    ['ɑ', 'AH'],
    ['i', 'EE'],
    ['u', 'OO'],
  ].map(([symbol, name]) => [
    name,
    vowelTarget({ phoneme: getPhoneme(symbol) }),
  ]),
];

const { lips } = headLandmarks(DEFAULT_HEAD);
const sheet = render.createRaster(
  PANEL * VIEWS.length,
  PANEL * STATES.length + 30
);
render.drawText(sheet, LABEL, 8, 8, [20, 20, 20], 3);
STATES.forEach(([name, state], row) => {
  const meshes = headModel(DEFAULT_HEAD, { lod: 3, state });
  VIEWS.forEach((spec, column) => {
    const raster = render.createRaster(PANEL, PANEL);
    const view = { ...spec, center: [0, lips[1], lips[2] - 1], scale: 34 };
    for (const mesh of meshes) {
      if (COLORS[mesh.name] && mesh.name !== 'skin') {
        render.drawMesh(raster, mesh, view, COLORS[mesh.name]);
      }
    }
    const skin = meshes.find((mesh) => mesh.name === 'head');
    render.drawMesh(raster, skin, view, COLORS.skin, { alpha: 0.3 });
    render.drawText(raster, `${name} ${spec.name}`, 6, 6, [20, 20, 20], 2);
    render.pasteRaster(sheet, raster, column * PANEL, 30 + row * PANEL);
  });
});
writeFileSync(OUT, render.encodePng(sheet, deflateSync));
console.log('wrote', OUT);
