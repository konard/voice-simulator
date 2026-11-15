// Per-formant bandwidth errors of the waveguide against Hawks & Miller for
// one setting: node experiments/issue-36-detail.mjs SHAPE BAFFLE STAGES
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { publishedBandwidth } from '../src/acoustics/losses.js';
import { STORY_AREAS, STORY_LENGTHS } from '../src/articulation/vowel-space.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const [lossShape, baffle, lossStages] = process.argv.slice(2).map(Number);
const head = normalizeHeadConfig({});
let sum = 0,
  count = 0;
const columns = [[], [], []];
for (const name of Object.keys(STORY_AREAS)) {
  const areas = STORY_AREAS[name];
  const length = STORY_LENGTHS[name];
  const solver = new Waveguide({
    sections: areas.length,
    head,
    lossShape,
    baffle,
    lossStages,
  });
  solver.setShape(areas, 0, Math.round(areas.length * 0.45));
  solver.setLength(length);
  solver.glottalReflection = 1;
  const rate = (areas.length * SPEED_OF_SOUND) / length;
  const response = new Float64Array(Math.round(0.25 * rate));
  for (let i = 0; i < response.length; i++) {
    response[i] = solver.step(i === 0 ? 1 : 0, 0, 0);
  }
  const peaks = resonances(
    impulseSpectrum(response, rate, { from: 100, to: 4600, step: 2 }),
    { count: 4 }
  );
  const row = peaks.slice(0, 3).map(({ frequency, bandwidth }, k) => {
    const e =
      (bandwidth - publishedBandwidth(frequency)) /
      publishedBandwidth(frequency);
    sum += Math.abs(e);
    count++;
    columns[k].push(e);
    return `${frequency.toFixed(0)}/${bandwidth.toFixed(0)} vs ${publishedBandwidth(frequency).toFixed(0)} (${(100 * e).toFixed(0)}%)`;
  });
  console.log(`[${name}] ${row.join('  ')}`);
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
console.log(
  `signed mean B1 ${(100 * mean(columns[0])).toFixed(1)} B2 ${(100 * mean(columns[1])).toFixed(1)} B3 ${(100 * mean(columns[2])).toFixed(1)} %; MAE ${((100 * sum) / count).toFixed(1)} %`
);
