/** Stage A tract (17500 / median dF) of the default head over tract length,
 * pitch and text (issue 63): is the bias a function of the reading and f0?
 * Usage: node tract-pitch-grid.mjs */
import { synthesize } from '../../src/index.js';
import {
  accumulate,
  emptyState,
  stateFeatures,
} from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = [
  ['match', MATCH_TEXT],
  [
    'heavy',
    'The north wind and the sun were disputing which was the stronger.',
  ],
  ['short', 'The north wind and the sun.'],
];
const lengths = [12, 14, 16, 18, 19];
const pitches = [90, 130, 180, 260];
for (const [name, text] of texts) {
  console.log(`${name}: rows tract, columns pitch ${pitches.join(' ')}`);
  for (const L of lengths) {
    const row = [];
    for (const pitch of pitches) {
      const { samples } = synthesize(text, {
        head: { vocalTractLength: L, pitch },
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const f = stateFeatures(accumulate(emptyState(), samples, 16000));
      row.push((f.vocalTractLength / L).toFixed(3));
    }
    console.log(`  ${L} ${row.join(' ')}`);
  }
}
