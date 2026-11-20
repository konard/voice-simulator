/** Compare quantized rows when reusing the Rust waveguide renderer. Unlicense. */
import { readFileSync } from 'node:fs';
import { fitVoice } from '../src/analysis/voice-fit.js';
import { decodeWav } from '../src/audio/wav.js';
import { createEngine } from '../src/engine/index.js';
import { buildCodebookWithRenderer } from '../src/recognition/codebook.js';

const { samples, sampleRate } = decodeWav(
  readFileSync(globalThis.process.argv[2])
);
const { head } = fitVoice(samples, sampleRate, {
  refine: false,
  sourceDiagnostics: false,
});
const renderer = await createEngine({
  engine: 'rust',
  threads: 1,
  simd: false,
});
for (const input of [{}, head]) {
  const js = buildCodebookWithRenderer(input, { size: 256, cache: new Map() });
  const rust = buildCodebookWithRenderer(input, { size: 256 }, renderer);
  console.log(
    `Build time, JS: ${js.stats.buildMilliseconds.toFixed(2)} ms, Rust renderer: ${rust.stats.buildMilliseconds.toFixed(2)} ms`
  );
  for (const key of [
    'articulation',
    'formants',
    'envelope',
    'key',
    'phone',
    'tree',
  ]) {
    let count = 0;
    let difference = 0;
    for (let i = 0; i < js[key].length; i++) {
      if (js[key][i] !== rust[key][i]) {
        count++;
        difference = Math.max(difference, Math.abs(js[key][i] - rust[key][i]));
      }
    }
    console.log(`${key}: ${count} differences, maximum ${difference}`);
  }
}
