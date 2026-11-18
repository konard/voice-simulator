/** Steps of matchVoice for a preset voice with its transcript (issue 63).
 * Usage: node match-trace.mjs [preset] [size] */
import { fitVoiceSteps, synthesize } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const preset = process.argv[2] ?? 'female',
  size = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const target = presetHeadConfig(preset, size);
const { samples, sampleRate } = synthesize(TEXT, {
  head: target,
  solver: 'waveguide',
  sampleRate: 22050,
});
const keys = [
  'vocalTractLength',
  'pitch',
  'pitchRange',
  'tenseness',
  'speechRate',
];
const pick = (h) =>
  JSON.stringify(Object.fromEntries(keys.map((k) => [k, +h[k].toFixed(3)])));
console.log('truth', pick(target));
const steps = fitVoiceSteps(samples, sampleRate, {
  transcript: TEXT,
  maxRenders: 40,
  trace: (t) =>
    t.stage === 'voice-fit-render' &&
    console.log(
      '  render',
      t.renders,
      pick(t.head),
      +t.distance.toFixed(3),
      'mcd',
      t.mcd === null ? '' : +t.mcd.toFixed(2)
    ),
});
for (let step = steps.next(); ; step = steps.next()) {
  if (step.done) {
    console.log('result', pick(step.value.head), step.value.distance);
    break;
  }
  console.log(
    'step',
    step.value.renders,
    pick(step.value.head),
    step.value.distance
  );
}
