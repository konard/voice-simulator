/**
 * Issue 36: cost (ns) of one Waveguide step of this checkout and of SOURCE
 * (another src directory, e.g. a worktree of main), alternated in short
 * trials; the minimum of each is robust to other load on the machine.
 * Run: SOURCE=/tmp/main/src node experiments/issue-36-step-compare.mjs
 */
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';

const sources = [
  new URL('../src/', import.meta.url),
  ...(process.env.SOURCE
    ? [new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}`)]
    : []),
];
const subjects = [];
for (const source of sources) {
  const load = (path) => import(new URL(path, source).href);
  const { Waveguide } = await load('acoustics/waveguide.js');
  const { normalizeHeadConfig } = await load('head-config.js');
  const { noseShape } = await load('articulation/tract-shape.js');
  const head = normalizeHeadConfig({});
  const solver = new Waveguide({ sections: 44, head });
  solver.setNose(noseShape(head).areas);
  const areas = Array.from({ length: 44 }, (_, i) => 2 + Math.sin(i / 5));
  solver.setShape(areas, 0.1, 20);
  solver.setLength(17);
  subjects.push({ label: source.pathname, solver, best: Infinity });
}
const steps = 20000;
for (let trial = 0; trial < Number(process.env.TRIALS ?? 200); trial++) {
  for (const subject of subjects) {
    const { solver } = subject;
    const start = performance.now();
    for (let i = 0; i < steps; i++) {
      solver.step(i % 100 === 0 ? 1 : 0, 0, 0);
    }
    const ns = ((performance.now() - start) * 1e6) / steps;
    subject.best = Math.min(subject.best, ns);
  }
}
for (const { label, best } of subjects) {
  console.log(`${label}: ${best.toFixed(1)} ns per step`);
}
if (subjects.length > 1) {
  const ratio = subjects[0].best / subjects[1].best;
  console.log(`step slowdown: ${((ratio - 1) * 100).toFixed(1)} %`);
}
