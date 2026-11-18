// Unlicense. Issue 63: median inverse-filter rd (0.05 bins) of MATCH_TEXT on
// the default head by pitch, breathiness and tenseness; prints the
// TENSENESS_RD table of src/analysis/voice-fit-calibration.js.
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import {
  accumulate,
  emptyState,
  quantile,
} from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const pitch = [80, 110, 150, 210, 290],
  breathiness = [0.1, 0.4, 0.7, 1],
  tenseness = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
const rd = pitch.map((f0) =>
  breathiness.map((b) =>
    tenseness.map((t) => {
      const head = { ...DEFAULT_HEAD, pitch: f0, tenseness: t, breathiness: b };
      const { samples } = synthesize(MATCH_TEXT, {
        head,
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const value = +quantile(
        accumulate(emptyState(), samples, 16000),
        'rd'
      ).toFixed(3);
      console.error(f0, b, t, value);
      return value;
    })
  )
);
console.log(JSON.stringify({ tenseness, breathiness, pitch, rd }));
