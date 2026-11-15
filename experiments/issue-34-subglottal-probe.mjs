// Probe of the subglottal line (issue 34): resonances and -3 dB bandwidths
// of the wave arriving at the glottis after a flow impulse, for a value of
// SUBGLOTTAL_LOSS. Used to tune SUBGLOTTAL_LOSS.
// Usage: node experiments/issue-34-subglottal-probe.mjs [loss] [dt]
import { SUBGLOTTAL_LOSS, Subglottal } from '../src/acoustics/subglottal.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';

const loss = Number(process.argv[2] ?? SUBGLOTTAL_LOSS);
const dt = Number(process.argv[3] ?? 16.5 / (44 * 35000));
const head = { ...DEFAULT_HEAD, wallLoss: loss / SUBGLOTTAL_LOSS };
const line = new Subglottal(head, dt);
const response = new Float64Array(Math.round(0.2 / dt));
for (let index = 0; index < response.length; index++) {
  line.step(index === 0 ? 1 : 0);
  response[index] = line.incident;
}
console.log(`SUBGLOTTAL_LOSS ${loss}, dt ${dt.toExponential(4)} s, ${line.n} sections`);
const spectrum = impulseSpectrum(response, 1 / dt, { from: 100, to: 4000, step: 5 });
for (const { frequency, bandwidth } of resonances(spectrum, { count: 3 })) {
  console.log(`  ${frequency.toFixed(0)} Hz, bandwidth ${bandwidth.toFixed(0)} Hz`);
}
