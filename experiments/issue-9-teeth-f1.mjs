// Low-frequency response of the 3D solver with and without the incisor
// slot, for a uniform tube (issue 9: F1 vanished with the teeth).
// Usage: node experiments/issue-9-teeth-f1.mjs <dx> <gap|none> [area]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { spectrum, extrema } from './issue-9-transfer-lib.mjs';

const [dxText = '0.5', gapText = 'none', areaText = '3'] =
  process.argv.slice(2);
const dx = Number(dxText);
const head = normalizeHeadConfig({});
const model = buildVoxelModel(head, { dx });
const solver = new Fdtd3d({ head, model, kernel: 'js' });
const areas = new Array(44).fill(Number(areaText));
const teeth =
  gapText === 'none'
    ? null
    : { gap: Number(gapText), area: Number(gapText) * 2.6 };
solver.setShape(areas, 0, 20, teeth);
const rate = 1 / solver.stepDuration();
const response = new Float64Array(Math.round(rate * 0.08));
for (let n = 0; n < response.length; n++) {
  response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
}
const spec = spectrum(response, rate, 100, 4000, 20);
console.log(
  `gap ${gapText} area ${areaText}: peaks ${extrema(spec, 1).join(' ')} | 100 Hz ${spec[0][1].toFixed(1)} dB, DC sum ${response.reduce((a, b) => a + b, 0).toFixed(4)}`
);
