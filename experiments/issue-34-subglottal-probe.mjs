// Probe of the subglottal line (issue 34): resonances and -3 dB bandwidths
// of the wave arriving at the glottis after a flow impulse, for a value of
// SUBGLOTTAL_LOSS. Used to tune SUBGLOTTAL_LOSS.
// Usage: node experiments/issue-34-subglottal-probe.mjs [loss] [dt]
import { SUBGLOTTAL_LOSS } from '../src/acoustics/subglottal.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { subglottalResonances } from '../tests/helpers/interaction.js';

const loss = Number(process.argv[2] ?? SUBGLOTTAL_LOSS);
const dt = Number(process.argv[3] ?? 16.5 / (44 * 35000));
const head = { ...DEFAULT_HEAD, wallLoss: loss / SUBGLOTTAL_LOSS };
console.log(`SUBGLOTTAL_LOSS ${loss}, dt ${dt.toExponential(4)} s`);
for (const { frequency, bandwidth } of subglottalResonances(head, dt)) {
  console.log(
    `  ${frequency.toFixed(0)} Hz, bandwidth ${bandwidth.toFixed(0)} Hz`
  );
}
