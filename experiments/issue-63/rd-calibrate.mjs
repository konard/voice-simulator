// Unlicense. Issue 63: median inverse-filter rd of MATCH_TEXT on the default
// head versus the true LF Rd (lfParameters) by pitch; a few breathiness 0.6
// rows check that the reading depends on the total Rd only.
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import {
  accumulate,
  emptyState,
  quantile,
} from '../../src/analysis/voice-fit-statistics.js';
import { lfParameters } from '../../src/acoustics/glottis.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
for (const pitch of [80, 110, 150, 210, 290]) {
  for (const [tenseness, breathiness] of [
    [0.1, 0.2],
    [0.2, 0.2],
    [0.3, 0.2],
    [0.4, 0.2],
    [0.5, 0.2],
    [0.6, 0.2],
    [0.7, 0.2],
    [0.8, 0.2],
    [0.9, 0.2],
    [0.8, 0.6],
    [0.5, 0.6],
    [0.6, 0.9],
  ]) {
    const head = { ...DEFAULT_HEAD, pitch, tenseness, breathiness };
    const { samples } = synthesize(MATCH_TEXT, {
      head,
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const state = accumulate(emptyState(), samples, 16000);
    const rd = lfParameters(tenseness, breathiness).rd;
    console.log(
      JSON.stringify({
        pitch,
        tenseness,
        breathiness,
        rd: +rd.toFixed(3),
        measured: +quantile(state, 'rd').toFixed(3),
      })
    );
  }
}
