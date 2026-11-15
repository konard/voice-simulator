// Render time of one English sentence on tier medium (waveguide, 44
// sections, 48 kHz), median of 7 runs after one warm-up, for the 5 % budget
// of issue 35. Run it on this tree and on a checkout of main to compare:
//   node experiments/issue-35-speed.mjs [root]
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const root = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '..')
);
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { prepareUtterance } = await load('src/synthesize.js');
const { renderPlan } = await load('src/acoustics/voice.js');
const text =
  'The north wind and the sun were disputing which was the stronger.';
const { plan, renderOptions } = prepareUtterance(text, {
  lang: 'en',
  tier: 'medium',
  seed: 1,
});
let length = 0;
const render = () => {
  length = renderPlan(plan, renderOptions).length;
};
render();
const times = [];
for (let run = 0; run < 7; run += 1) {
  const start = performance.now();
  render();
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const seconds = length / renderOptions.sampleRate;
console.log(
  `${root}: ${seconds.toFixed(2)} s of audio, median ` +
    `${times[3].toFixed(0)} ms (rtf ${(times[3] / 1000 / seconds).toFixed(3)})`
);
