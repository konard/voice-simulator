/** Issue 36: bandwidths of a uniform tube (rigid walls, no piriform) in the
 * waveguide and the tube transfer function, for several loss shapes, to
 * check the loss filters alone.
 * Run: node experiments/issue-36-uniform.mjs [area] [stages] */
import { Waveguide } from '../src/acoustics/waveguide.js';
import { tubeSpectrum } from '../src/acoustics/transfer.js';
import { SPEED_OF_SOUND } from '../src/acoustics/constants.js';
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';

const area = Number(process.argv[2] ?? 3);
const lossStages = Number(process.argv[3] ?? 4);
const length = 17;
const areas = new Array(44).fill(area);
const show = (peaks) =>
  peaks
    .map(
      ({ frequency, bandwidth }) =>
        `${frequency.toFixed(0)}/${bandwidth.toFixed(1)}`
    )
    .join(' ');
for (const lossShape of [0, 1, 3]) {
  const options = { walls: false, piriform: false, lossShape, lossStages };
  const solver = new Waveguide({ sections: 44, ...options });
  solver.setShape(areas, 0, 20);
  solver.setLength(length);
  solver.glottalReflection = 1;
  const rate = (44 * SPEED_OF_SOUND) / length;
  const response = new Float64Array(Math.round(0.5 * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  const wave = resonances(
    impulseSpectrum(response, rate, { from: 100, to: 4000, step: 1 })
  );
  const tube = resonances(
    tubeSpectrum(areas, length, { ...options, step: 1, maxFrequency: 4000 })
  );
  console.log(`shape ${lossShape}: waveguide ${show(wave)}`);
  console.log(`         tube      ${show(tube)}`);
}
