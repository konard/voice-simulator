/** Aligned MCD of head A (with transcript) against renders at small pitch,
 * rate and tract changes from stage A and from the truth (issue 63). */
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { createMcdMetric } from '../../src/analysis/voice-fit-objective.js';
import { DEFAULT_HEAD } from '../../src/head-config.js';
const text = 'The north wind and the sun.';
const truth = {
  ...DEFAULT_HEAD,
  vocalTractLength: 14,
  pitch: 210,
  tenseness: 0.45,
  speechRate: 1.15,
};
const render = (head) =>
  synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  }).samples;
const audio = render(truth);
const mcd = createMcdMetric(audio, 16000);
const stage = fitVoice(audio, 16000, { transcript: text, refine: false }).head;
const show = (label, head) => console.log(label, +mcd(render(head)).toFixed(3));
const diff = Object.fromEntries(
  Object.keys(truth)
    .filter((k) => Math.abs(truth[k] - stage[k]) > 1e-9)
    .map((k) => [k, [+truth[k].toFixed(4), +stage[k].toFixed(4)]])
);
console.log('truth vs stage A', JSON.stringify(diff));
for (const [label, base] of [
  ['truth', truth],
  ['stageA', stage],
]) {
  show(`${label}`, base);
  show(`${label} pitch*1.003`, { ...base, pitch: base.pitch * 1.003 });
  show(`${label} rate 1.0325`, { ...base, speechRate: 1.0325 });
  show(`${label} rate 1.1625`, { ...base, speechRate: 1.1625 });
  show(`${label} tract 14.77`, { ...base, vocalTractLength: 14.77 });
}
for (const k of Object.keys(diff)) {
  show(`truth with stage A ${k}`, { ...truth, [k]: stage[k] });
}
