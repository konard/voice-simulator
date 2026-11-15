/**
 * Issue 36: cost (µs) of one Waveguide step and of one shape update
 * (setShape + setLength, as src/acoustics/voice.js does every block), to
 * find where tier medium spends the time of the frequency-dependent losses.
 * Run: node experiments/issue-36-step-cost.mjs
 *      SOURCE=/tmp/main/src node experiments/issue-36-step-cost.mjs
 */
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';

const source = process.env.SOURCE
  ? new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}`)
  : new URL('../src/', import.meta.url);
const load = (path) => import(new URL(path, source).href);
const { Waveguide } = await load('acoustics/waveguide.js');
const { normalizeHeadConfig } = await load('head-config.js');
const { noseShape } = await load('articulation/tract-shape.js');

const head = normalizeHeadConfig({});
const solver = new Waveguide({ sections: 44, head });
solver.setNose(noseShape(head).areas);
const areas = Array.from({ length: 44 }, (_, i) => 2 + Math.sin(i / 5));
const time = (count, action) => {
  for (let i = 0; i < count / 10; i++) {
    action(i);
  }
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    action(i);
  }
  return ((performance.now() - start) * 1000) / count;
};
const update = time(20000, (i) => {
  areas[i % 44] = 2 + Math.sin(i);
  solver.setShape(areas, 0.1 * (i % 2), 20);
  solver.setLength(17 + (i % 7) * 0.01);
});
const step = time(400000, (i) => solver.step(i % 100 === 0 ? 1 : 0, 0, 0));
console.log(`step ${step.toFixed(3)} µs, shape update ${update.toFixed(3)} µs`);
