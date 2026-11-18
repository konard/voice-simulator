// Unlicense. Aligned MCD of the male preset recording (legacy voice-match
// case, issue 63) against renders that vary only pitch, from the stage A head
// (default geometry) and from the true preset head.
import { synthesize, fitVoice } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { createMcdMetric } from '../../src/analysis/voice-fit-objective.js';
import { resample } from '../../src/audio/resample.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const truth = presetHeadConfig(process.argv[2] ?? 'male');
const { samples, sampleRate } = synthesize(TEXT, {
  head: truth,
  solver: 'waveguide',
  sampleRate: 22050,
});
const input = resample(Array.from(samples), sampleRate, 16000);
const mcd = createMcdMetric(input, 16000);
const stage = fitVoice(samples, sampleRate, {
  refine: false,
  transcript: TEXT,
}).head;
for (const [name, base] of [
  ['stageA', stage],
  ['truth', truth],
]) {
  for (const f of [0.8, 0.9, 1, 1.1]) {
    const head = { ...base, pitch: truth.pitch * f };
    const r = synthesize(TEXT, {
      head,
      sampleRate: 16000,
      solver: 'waveguide',
    });
    console.log(
      name,
      'pitch',
      head.pitch.toFixed(1),
      'mcd',
      mcd(r.samples).toFixed(2)
    );
  }
}
