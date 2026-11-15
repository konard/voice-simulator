// Issue 35: HNR and H1-H2 of MATCH_TEXT against the speech rate (waveguide,
// 16 kHz, seed 1) for the default head and the male and female presets:
// slow renders read a cleaner voice, which matchVoice must not read as a
// lower breathiness.
// Usage: node experiments/issue-35-rate-hnr.mjs
import { synthesize } from '../src/synthesize.js';
import { MATCH_TEXT } from '../src/analysis/voice-match.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const heads = {
  default: {},
  male: presetHeadConfig('male'),
  female: presetHeadConfig('female'),
};
console.log('head     speechRate  hnr dB  h1h2 dB  per log rate: hnr  h1h2');
for (const [name, head] of Object.entries(heads)) {
  let previous = null;
  for (const speechRate of [0.6, 0.8, 1, 1.25]) {
    const { samples, sampleRate } = synthesize(MATCH_TEXT, {
      head: { ...head, speechRate },
      sampleRate: 16000,
      solver: 'waveguide',
      seed: 1,
    });
    const { hnr, h1h2 } = analyzeVoice(samples, sampleRate);
    const slope = previous
      ? [hnr - previous.hnr, h1h2 - previous.h1h2].map((value) =>
          (value / Math.log(speechRate / previous.speechRate)).toFixed(1)
        )
      : ['', ''];
    console.log(
      `${name.padEnd(8)} ${String(speechRate).padStart(10)}  ${hnr.toFixed(2).padStart(6)}  ${h1h2.toFixed(2).padStart(7)}  ${slope[0].padStart(17)}  ${slope[1].padStart(4)}`
    );
    previous = { speechRate, hnr, h1h2 };
  }
}
