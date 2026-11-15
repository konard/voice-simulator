/** Issue 36: formants and bandwidths of the waveguide and the tube transfer
 * function with each loss mechanism on its own, to see which one disagrees.
 * Run: node experiments/issue-36-agreement.mjs [vowel...] */
import { Waveguide, piriformBranch } from '../src/acoustics/waveguide.js';
import { tubeSpectrum } from '../src/acoustics/transfer.js';
import { SPEED_OF_SOUND } from '../src/acoustics/constants.js';
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import { STORY_AREAS, STORY_LENGTHS } from '../src/articulation/vowel-space.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({});
const RANGE = { from: 100, to: 3600, step: 2 };
const show = (peaks) =>
  peaks
    .slice(0, 3)
    .map(
      ({ frequency, bandwidth }) =>
        `${frequency.toFixed(0)}/${bandwidth.toFixed(0)}`
    )
    .join(' ');
const vowels = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ɑ', 'i', 'u'];
for (const name of vowels) {
  const areas = STORY_AREAS[name];
  const length = STORY_LENGTHS[name];
  for (const options of [
    { walls: false, lossShape: 0, piriform: false },
    { walls: false, lossShape: 0 },
    { walls: false },
    { lossShape: 0 },
    {},
    { walls: false, piriform: false },
    { piriform: false },
  ]) {
    const solver = new Waveguide({
      sections: areas.length,
      head,
      lossStages: Number(process.env.STAGES ?? 4),
      ...options,
    });
    solver.setShape(areas, 0, Math.round(areas.length * 0.45));
    solver.setLength(length);
    solver.glottalReflection = 1;
    const rate = (areas.length * SPEED_OF_SOUND) / length;
    const response = new Float64Array(Math.round(0.3 * rate));
    for (let index = 0; index < response.length; index++) {
      response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
    }
    const wave = resonances(impulseSpectrum(response, rate, RANGE));
    const tube = resonances(
      tubeSpectrum(areas, length, {
        head,
        step: 2,
        maxFrequency: RANGE.to,
        branches:
          options.piriform === false
            ? []
            : [piriformBranch(areas.length, length, head)],
        ...options,
      })
    );
    console.log(
      `[${name}] ${JSON.stringify(options).padEnd(46)} waveguide ${show(wave).padEnd(28)} tube ${show(tube)}`
    );
  }
}
