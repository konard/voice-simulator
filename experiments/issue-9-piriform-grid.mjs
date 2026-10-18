// /ɑ/ F1 lowering by the piriform fossae in the 3D solver at several grid
// steps against the waveguide's, on the default head (as tests/fdtd3d.test.js).
// Usage: node experiments/issue-9-piriform-grid.mjs [dx ...]
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme('ɑ') }), rhotic: 0 },
  DEFAULT_HEAD
);
function firstPeak(solver, rate) {
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, 0);
  const response = new Float64Array(Math.round(rate * 0.06));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 })[0];
}
const tube = (piriform) =>
  firstPeak(
    new Waveguide({ sections: shape.areas.length, piriform }),
    (shape.areas.length * SPEED_OF_SOUND) / shape.length
  );
const shift1d = tube(true) / tube(false);
const steps = process.argv.slice(2).map(Number);
for (const dx of steps.length ? steps : [1, 0.8, 0.5]) {
  const [withFossae, without] = [true, false].map((piriform) => {
    const solver = new Fdtd3d({
      model: buildVoxelModel(DEFAULT_HEAD, { dx, piriform, vallecula: false }),
    });
    return firstPeak(solver, 1 / solver.stepDuration(shape));
  });
  const shift3d = withFossae / without;
  console.log(
    `dx ${dx} F1 ${Math.round(without)} -> ${Math.round(withFossae)} shift 3D ${shift3d.toFixed(4)} 1D ${shift1d.toFixed(4)} difference ${Math.abs(shift3d - shift1d).toFixed(4)}`
  );
}
