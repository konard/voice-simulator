// Vocal tract length that analyzeVoice estimates from rendered speech, for
// several LPC orders, with and without the piriform fossae. The piriform
// antiresonance (about 4-5 kHz) takes up LPC poles, so a low order can
// lose F2 on long (male) tracts.
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../src/analysis/voice-match.js';
import { presetHeadConfig } from '../src/head-config.js';

for (const name of ['male', 'female', 'child']) {
  for (const size of [0.2, 0.8]) {
    const head = presetHeadConfig(name, size);
    const row = [];
    for (const piriform of [true, false]) {
      const { samples, sampleRate } = synthesize(MATCH_TEXT, {
        head,
        lang: 'en',
        sampleRate: 16000,
        piriform,
      });
      for (const order of [12, 14]) {
        const features = analyzeVoice(samples, sampleRate, { order });
        row.push(
          `p=${piriform ? 1 : 0} o=${order} ${features.vocalTractLength.toFixed(1)}`
        );
      }
    }
    console.log(
      name,
      size,
      'true',
      head.vocalTractLength.toFixed(1),
      '|',
      row.join(' | ')
    );
  }
}
