// Measure the voice features of preset voices and compare the formant-spacing
// tract length with the head's vocalTractLength.
// Usage: node experiments/issue-5-voice-features.mjs [text]
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { presetHeadConfig, randomHeadConfig } from '../src/head-config.js';

const text = process.argv[2] ?? 'The north wind and the sun were disputing.';
const heads = [];
for (const preset of ['male', 'female', 'child']) {
  heads.push([`${preset} typical`, presetHeadConfig(preset)]);
  for (const seed of [1, 2]) {
    heads.push([`${preset} seed ${seed}`, randomHeadConfig(seed, { preset })]);
  }
}
for (const [name, head] of heads) {
  const started = globalThis.performance.now();
  const result = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
  });
  const rendered = globalThis.performance.now();
  const features = analyzeVoice(result.samples, result.sampleRate);
  const analysed = globalThis.performance.now();
  console.log(
    name.padEnd(16),
    `pitch ${head.pitch.toFixed(0)} f0 ${features.f0.toFixed(0)}`,
    `range ${head.pitchRange} -> ${features.f0Range.toFixed(1)}st`,
    `VTL ${head.vocalTractLength} raw ${features.vocalTractLength.toFixed(2)}`,
    `ratio ${(head.vocalTractLength / features.vocalTractLength).toFixed(3)}`,
    `F ${features.formants.map((value) => value.toFixed(0)).join('/')}`,
    `tense ${head.tenseness} h1h2 ${features.h1h2.toFixed(1)}`,
    `breath ${head.breathiness} hnr ${features.hnr.toFixed(1)}`,
    `rate ${features.syllableRate.toFixed(2)}`,
    `render ${(rendered - started).toFixed(0)}ms analyse ${(analysed - rendered).toFixed(0)}ms`
  );
}
