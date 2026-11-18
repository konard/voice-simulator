/** Stage A and the evaluations of stage B for a test head (issue 63).
 * Usage: node stage-b-trace.mjs [head index 0|1] [transcript 1|0] */
import { fitVoiceSteps, synthesize } from '../../src/index.js';
const TEXT = 'The north wind and the sun.';
const HEADS = [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
];
const i = Number(process.argv[2] ?? 0),
  transcript = process.argv[3] !== '0';
const head = HEADS[i];
const audio = synthesize(TEXT, {
  head,
  sampleRate: 16000,
  solver: 'waveguide',
  seed: 1,
  engine: 'js',
});
const pick = (h) =>
  JSON.stringify(
    Object.fromEntries(Object.keys(head).map((k) => [k, +h[k].toFixed(4)]))
  );
const steps = fitVoiceSteps(audio.samples, audio.sampleRate, {
  transcript: transcript ? TEXT : undefined,
  maxRenders: 10,
});
for (let step = steps.next(); ; step = steps.next()) {
  if (step.done) {
    console.log('result', pick(step.value.head), step.value.distance);
    break;
  }
  const v = step.value;
  console.log(
    Object.keys(v).join(','),
    v.stage ?? v.phase ?? '',
    v.renders ?? '',
    v.head ? pick(v.head) : '',
    v.distance ?? ''
  );
}
