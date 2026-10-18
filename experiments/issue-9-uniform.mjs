// Resonances of a uniform tube (every section the same area) in the
// waveguide and the 3D solver: isolates the 3D geometry (bend, radiation
// end correction, porous fill) from the area function (issue 9).
// Usage: node experiments/issue-9-uniform.mjs [area] [dx]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide, REST_LENGTH } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { spectrum, extrema } from './issue-9-transfer-lib.mjs';

const [areaText = '3', dxText = '0.5'] = process.argv.slice(2);
const area = Number(areaText);
const dx = Number(dxText);
const head = normalizeHeadConfig({});
const respond = (solver, rate, seconds = 0.08) =>
  Float64Array.from({ length: Math.round(rate * seconds) }, (_, n) =>
    solver.step(n === 0 ? 1 : 0, 0, 0)
  );
const sections = 88;
const wg = new Waveguide({ sections, head, piriform: false });
wg.setShape(new Array(sections).fill(area), 0, 0);
const wgRate = (sections * SPEED_OF_SOUND) / REST_LENGTH;
console.log(
  `quarter-wave ${(SPEED_OF_SOUND / (4 * REST_LENGTH)).toFixed(0)} Hz, length ${REST_LENGTH}`
);
console.log(
  `waveguide peaks ${extrema(spectrum(respond(wg, wgRate), wgRate), 1, 3).join(' ')}`
);
const solver = new Fdtd3d({
  head,
  dx,
  piriform: false,
  vallecula: false,
  kernel: 'js',
});
solver.setShape(new Array(44).fill(area), 0, 0, null);
const rate = 1 / solver.stepDuration();
console.log(
  `3D dx ${dx} peaks ${extrema(spectrum(respond(solver, rate), rate), 1, 3).join(' ')}`
);
