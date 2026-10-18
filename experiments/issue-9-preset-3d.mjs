/**
 * Impulse-response peaks of the measured vowels on the mid-size head of each
 * preset in the tube model (piriform fossae included), the waveguide and the
 * 3D solver (with the incisors and its own vowel table, as the renderer
 * sets it up), against Hillenbrand et al. (1995). No pitch is involved, so the
 * numbers show the resonances each solver gives the preset's tract.
 * Usage: node experiments/issue-9-preset-3d.mjs [dx=1] [vowels=iɑu]
 */
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide, piriformBranch } from '../src/acoustics/waveguide.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { presetHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 1);
const vowels = [...(process.argv[3] ?? 'iɑu')];

function peaks(solver, rate, seconds = 0.06) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 })
    .filter((value) => value > 150)
    .slice(0, 3)
    .map(Math.round);
}

const errors = { wg: [], '3D': [] };
for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  const model = buildVoxelModel(head, { dx });
  const nose = noseShape(head).areas;
  console.log(`${preset}: VTL ${head.vocalTractLength} cm`);
  for (const vowel of vowels) {
    const [height, backness, rounding] = STORY_FEATURES[vowel];
    const shape = tractShape({ height, backness, rounding }, head);
    const shape3d = tractShape({ height, backness, rounding }, head, {
      vowelCorrections: VOWEL_CORRECTIONS_3D,
    });
    const tube = tubeFormants(shape.areas, shape.length, {
      count: 3,
      branches: [piriformBranch(shape.areas.length, shape.length, head)],
    }).map(Math.round);
    const wg = new Waveguide({ sections: shape.areas.length, head });
    wg.setNose(nose);
    wg.setShape(shape.areas, 0, shape.velumIndex);
    wg.setLength(shape.length);
    const wgPeaks = peaks(
      wg,
      (shape.areas.length * SPEED_OF_SOUND) / shape.length
    );
    const fdtd = new Fdtd3d({ model });
    fdtd.setNose(nose);
    fdtd.setShape(shape3d.areas, 0, shape3d.velumIndex, shape3d.teeth);
    const fdtdPeaks = peaks(fdtd, 1 / fdtd.stepDuration(shape3d));
    const target = HILLENBRAND[preset][vowel];
    for (const [name, list] of [
      ['wg', wgPeaks],
      ['3D', fdtdPeaks],
    ]) {
      list.forEach((value, index) =>
        errors[name].push(Math.log(value / target[index]))
      );
    }
    console.log(
      `  /${vowel}/ Hillenbrand ${target.join(' ')} | tube ${tube.join(' ')} | wg ${wgPeaks.join(' ')} | 3D dx ${dx} ${fdtdPeaks.join(' ')}`
    );
  }
}
for (const [name, list] of Object.entries(errors)) {
  const rms = Math.sqrt(
    list.reduce((sum, value) => sum + value * value, 0) / list.length
  );
  console.log(`${name} rms log error ${(100 * rms).toFixed(1)}%`);
}
