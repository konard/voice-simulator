// Unlicense. Stage A dF length of the default head at several tract
// lengths and texts: is the excess an end correction (offset) or a ratio?
import { synthesize } from '../../src/index.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = [
  MATCH_TEXT,
  'The north wind and the sun were disputing which was the stronger.',
  'The north wind and the sun.',
];
for (const text of texts) {
  const row = [];
  for (const L of [12, 14, 16.5, 18.5, 20]) {
    const { samples } = synthesize(text, {
      head: { vocalTractLength: L },
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const r = fitVoice(samples, 16000, { refine: false });
    row.push(`${L}->${r.head.vocalTractLength.toFixed(3)}`);
  }
  console.log(text.slice(0, 24), row.join('  '));
}
