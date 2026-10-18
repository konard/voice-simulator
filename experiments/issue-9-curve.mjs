// Prints the transfer function (dB, 100 Hz steps) of one vowel for the
// waveguide and the 3D solver side by side, to compare the curves (issue 9).
// Usage: node experiments/issue-9-curve.mjs <vowel> <dx> [JSON model options]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { spectrum } from './issue-9-transfer-lib.mjs';

const [symbol = 'i', dxText = '1', optionText = '{}'] = process.argv.slice(2);
const dx = Number(dxText);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);

function respond(solver, rate, seconds = 0.1) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return response;
}

const sections = 88;
const wg = new Waveguide({ sections, head });
const areas = Array.from(
  { length: sections },
  (_, i) =>
    s.areas[
      Math.min(s.areas.length - 1, Math.floor((i * s.areas.length) / sections))
    ]
);
wg.setShape(areas, 0, 40);
const wgRate = (sections * SPEED_OF_SOUND) / s.length;
const wgSpec = spectrum(respond(wg, wgRate), wgRate, 100, 8000, 100);
const model = buildVoxelModel(head, { dx, ...JSON.parse(optionText) });
const solver = new Fdtd3d({ head, model });
solver.setShape(
  s.areas,
  0,
  s.velumIndex,
  process.env.NO_TEETH ? null : (s.teeth ?? null)
);
const rate = 1 / solver.stepDuration(s);
const spec = spectrum(respond(solver, rate), rate, 100, 8000, 100);
const offset = spec[0][1] - wgSpec[0][1];
for (let i = 0; i < spec.length; i++) {
  const w = wgSpec[i][1];
  const v = spec[i][1] - offset;
  const bar = (value) => ' '.repeat(Math.max(0, Math.round((value + 40) / 2)));
  console.log(
    `${String(spec[i][0]).padStart(5)} wg ${w.toFixed(1).padStart(6)} 3D ${v.toFixed(1).padStart(6)} |${bar(w)}w`
  );
  console.log(`${' '.repeat(29)}|${bar(v)}3`);
}
