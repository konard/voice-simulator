// Where do the vowel-independent dips of the 3D transfer function come from?
// Uniform tube, varying radiation radius and model options (issue 9).
// Usage: node experiments/issue-9-dips.mjs <dx> [JSON model options] [area]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { spectrum, extrema } from './issue-9-transfer-lib.mjs';

const dx = Number(process.argv[2] ?? 1);
const options = JSON.parse(process.argv[3] ?? '{}');
const area = Number(process.argv[4] ?? 3);
const head = normalizeHeadConfig({});
const areas = new Array(44).fill(area);
console.log(
  `uniform ${area} cm² tube formants ${tubeFormants(areas, head.vocalTractLength, { count: 6, maxFrequency: 8000 }).map(Math.round).join(' ')}`
);
const model = buildVoxelModel(head, { dx, ...options });
const solver = new Fdtd3d({ head, model });
solver.setShape(areas, 0, 22, null);
const rate = 1 / solver.stepDuration();
const response = new Float64Array(Math.round(rate * 0.08));
for (let n = 0; n < response.length; n++) {
  response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
}
const spec = spectrum(response, rate);
console.log(
  `3D dx ${dx} ${JSON.stringify(options)} peaks ${extrema(spec, 1).join(' ')} | dips ${extrema(spec, -1).join(' ')}`
);
