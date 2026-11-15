// RMS level of the [m] murmur in 'ˈama' for nasalLoss 1, 3 (default) and
// 8, as in tests/head-parameters.test.js. SOURCE=<src dir> measures another
// checkout. Run: node experiments/issue-36-nasal-murmur.mjs
import { URL } from 'node:url';

const source = process.env.SOURCE
  ? new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}`)
  : new URL('../src/', import.meta.url);
const load = (path) => import(new URL(path, source).href);
const { planUtterance } = await load('articulation/plan.js');
const { renderPlan } = await load('acoustics/voice.js');
const { rms } = await load('acoustics/analysis.js');
const { normalizeHeadConfig } = await load('head-config.js');

const RATE = 16000;
const level = (nasalLoss) => {
  const head = normalizeHeadConfig({ nasalLoss });
  const plan = planUtterance('ˈama', { head });
  const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
  const nasal = plan.segments.find((item) => item.kind === 'consonant');
  return rms(
    samples,
    Math.floor(nasal.start * RATE),
    Math.floor(nasal.end * RATE)
  );
};
const levels = [1, 3, 8].map(level);
console.log(
  `murmur rms at nasalLoss 1/3/8: ${levels.map((v) => v.toFixed(4)).join(' / ')}; ratios 3:1 ${(levels[1] / levels[0]).toFixed(3)}, 8:3 ${(levels[2] / levels[1]).toFixed(3)}`
);
