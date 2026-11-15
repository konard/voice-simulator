// Issue 35: HNR and H1-H2 of MATCH_TEXT against breathiness (default head,
// waveguide, 16 kHz, seed 1), to compare the low end of the curve that
// matchVoice reads breathiness from with main.
// Usage: node experiments/issue-35-hnr-floor.mjs [root of a checkout]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '..')
);
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { synthesize } = await load('src/synthesize.js');
const { MATCH_TEXT } = await load('src/analysis/voice-match.js');
const { analyzeVoice } = await load('src/analysis/voice-features.js');

console.log('breathiness  hnr dB  h1h2 dB');
for (const breathiness of [0, 0.1, 0.2, 0.3, 0.5]) {
  const { samples, sampleRate } = synthesize(MATCH_TEXT, {
    head: { breathiness },
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
  });
  const { hnr, h1h2 } = analyzeVoice(samples, sampleRate);
  console.log(
    `${String(breathiness).padStart(11)}  ${hnr.toFixed(2).padStart(6)}  ${h1h2.toFixed(2).padStart(7)}`
  );
}
