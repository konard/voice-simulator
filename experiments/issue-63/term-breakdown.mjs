// Unlicense. Per-term objective contributions for head B (issue 63):
// the true head, single stage-A deviations from it, and stage A itself.
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { accumulate, emptyState } from '../../src/analysis/voice-fit-statistics.js';
import { createMcdMetric, featureVector, vectorDistance } from '../../src/analysis/voice-fit-objective.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';
const text = 'The north wind and the sun.';
const which = Number(process.argv[2] ?? 1);
const truthPartial = [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
][which];
const truth = { ...DEFAULT_HEAD, ...truthPartial };
const render = (head) => synthesize(text, { head, seed: 1, sampleRate: 16000, solver: 'waveguide', engine: 'js' });
const audio = render(truth);
const stage = fitVoice(audio.samples, 16000, { refine: false });
const target = featureVector(stage.state);
const mcd = createMcdMetric(audio.samples, 16000);
const keys = ['vocalTractLength', 'pitch', 'pitchRange', 'tenseness', 'speechRate', 'breathiness', 'jitter', 'shimmer'];
console.log('truth  ', JSON.stringify(Object.fromEntries(keys.map((k) => [k, +truth[k].toFixed(4)]))));
console.log('stageA ', JSON.stringify(Object.fromEntries(keys.map((k) => [k, +stage.head[k].toFixed(4)]))));
const names = ['lnf0', 'range', 'lndF', 'F1', 'F2', 'F3', 'rd', 'h1h2S', 'cpp', 'hnr', 'tilt', 'rate'];
const cases = [['truth', truth], ['stageA', stage.head]];
for (const k of keys) {
  if (Math.abs(stage.head[k] - truth[k]) > 1e-9) {
    cases.push([`truth+A.${k}`, { ...truth, [k]: stage.head[k] }]);
    cases.push([`A+true.${k}`, { ...stage.head, [k]: truth[k] }]);
  }
}
for (const [name, head] of cases) {
  const c = render(head);
  const v = featureVector(accumulate(emptyState(), c.samples, 16000, {}, false));
  const m = mcd(c.samples);
  const terms = v.values.map((x, i) => (x === null || target.values[i] === null ? 0 : ((x - target.values[i]) / target.scales[i]) ** 2));
  const top = terms.slice(0, 12).map((t, i) => `${names[i]}=${t.toFixed(1)}`).join(' ');
  const melSum = terms.slice(12).reduce((a, b) => a + b, 0);
  console.log(name.padEnd(22), 'J', vectorDistance(target, v, true, m).toFixed(3), 'mcd', m.toFixed(2), 'mel', melSum.toFixed(1), top);
}
