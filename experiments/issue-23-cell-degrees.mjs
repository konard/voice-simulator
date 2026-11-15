/**
 * Issue 23: how many links touch each cell of the solver grid (with the
 * spherical boundary of tier high when there is no enclosure). The gather
 * form sums one list per cell; this histogram shows how uniform the list
 * lengths are.
 *
 *   node experiments/issue-23-cell-degrees.mjs [dx] [enclosure cm]
 */
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { prepareUtterance } from '../src/synthesize.js';

const dx = Number(process.argv[2] ?? 1);
const size = process.argv[3] ? Number(process.argv[3]) : 0;
const { renderOptions } = prepareUtterance('Hello.', { tier: 'high', seed: 1 });
const options = {
  ...renderOptions,
  dx,
  enclosure: size ? { width: size, height: size, depth: size } : undefined,
};
const model = buildVoxelModel(DEFAULT_HEAD, voxelModelOptions(options));
const solver = new Fdtd3d({
  ...options,
  model,
  head: DEFAULT_HEAD,
  kernel: 'js',
});
const degree = new Uint32Array(solver.cellCount);
for (let link = 0; link < solver.linkCount; link++) {
  degree[solver.linkA[link]]++;
  degree[solver.linkB[link]]++;
}
const histogram = new Map();
for (const value of degree) {
  histogram.set(value, (histogram.get(value) ?? 0) + 1);
}
console.log(
  `dx ${dx}, enclosure ${size || 'none'}: ${solver.cellCount} cells, ${solver.linkCount} links`
);
for (const [value, count] of [...histogram].sort((a, b) => a[0] - b[0])) {
  console.log(`  degree ${value}: ${count}`);
}
