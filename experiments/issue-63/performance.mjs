// Unlicense. Bounded ten-second timing of the public fitter (issue 63).
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const audio = synthesize(`${MATCH_TEXT} ${MATCH_TEXT} ${MATCH_TEXT}`, {
  sampleRate: 16000,
  solver: 'waveguide',
  seed: 1,
  engine: 'js',
});
const samples = audio.samples.subarray(0, 160000);
if (samples.length !== 160000) {
  throw new Error('Need ten seconds');
}
let start = performance.now();
const stage = fitVoice(samples, 16000, { refine: false });
const statisticsSeconds = (performance.now() - start) / 1000;
start = performance.now();
const fit = fitVoice(samples, 16000);
const fitSeconds = (performance.now() - start) / 1000;
console.log(
  JSON.stringify(
    {
      command: 'node experiments/issue-63/performance.mjs',
      runtime: process.version,
      cpu: cpus()[0].model,
      seconds: samples.length / 16000,
      statisticsSeconds,
      rtf: statisticsSeconds / 10,
      fitSeconds,
      renders: fit.renders,
      voicedFrames: stage.state.voicedFrames,
      distance: fit.distance,
      memory: process.memoryUsage(),
    },
    null,
    2
  )
);
