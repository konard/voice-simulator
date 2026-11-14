// Issue 32: the default head must sound the same after the breathiness fix.
// Prints the RMS level (dB re full scale), the H1-H2 and the HNR (dB) of
// audio rendered with the default head, per tier and text. The HNR moves
// with the measure itself; the level and H1-H2 show the audio.
// Run: node experiments/issue-32-default-head.mjs > experiments/issue-32-default-head-after.txt
// (the "before" file was written with the same script on the code of main)
import { synthesize, analyzeVoice } from '../src/index.js';

const round = (value, digits = 2) => Number(value.toFixed(digits));
const cases = [
  [
    'sentence medium',
    'Please call Stella and ask her to bring these things with her.',
    { tier: 'medium' },
  ],
  [
    'sentence minimal',
    'Please call Stella and ask her to bring these things with her.',
    { tier: 'minimal' },
  ],
  [
    'north wind waveguide 16 kHz',
    'The north wind and the sun were disputing.',
    { solver: 'waveguide', sampleRate: 16000 },
  ],
  ['steady [aː] medium', 'aː', { tier: 'medium', ipa: true }],
];
for (const [label, text, options] of cases) {
  const { samples, sampleRate } = synthesize(text, { seed: 1, ...options });
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  const level = 10 * Math.log10(sum / samples.length);
  const features = analyzeVoice(samples, sampleRate);
  console.log(
    `${label}: ${JSON.stringify({
      rmsDb: round(level),
      h1h2: round(features.h1h2),
      hnr: round(features.hnr),
    })}`
  );
}
