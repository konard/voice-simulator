// The LF source of each phonation type alone (issue 54): the level of the
// breath noise against the pulses (two glottises with the same seed, one
// with noise and one without, as part 1 of experiments/issue-11-audit-m2.mjs),
// the pulse f0 and the level of the pulses against modal voice.
// node experiments/issue-54-source.mjs > experiments/issue-54-source.txt
import { Glottis } from '../src/acoustics/glottis.js';
import { Biquad, createNoise } from '../src/acoustics/filters.js';
import { channelsOf, voiceRd } from '../src/articulation/phonation.js';

const RATE = 48000;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const db = (x) => 20 * Math.log10(x);
let modalLevel;
for (const type of [
  'modal',
  'breathy',
  'lax',
  'pressed',
  'creaky',
  'falsetto',
  'harsh',
]) {
  const channels = channelsOf(type === 'modal' ? {} : { [type]: 1 });
  const control = {
    f0: 120,
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    ...channels,
  };
  const make = () => new Glottis({ seed: 1, tenseness: 0.6, breathiness: 0.2 });
  const clean = make();
  const breathy = make();
  const white = createNoise('m2:noise');
  const band = new Biquad();
  band.bandpass(800, 0.5, RATE);
  const pulses = new Float64Array(RATE);
  const noise = new Float64Array(RATE);
  let crossings = 0;
  let prev = 1;
  for (let index = 0; index < RATE; index++) {
    const sample = band.process(white());
    pulses[index] = clean.step(1 / RATE, control, 0);
    noise[index] = breathy.step(1 / RATE, control, sample) - pulses[index];
    if (clean.phase < prev) {
      crossings++;
    }
    prev = clean.phase;
  }
  const level = db(rms(pulses));
  modalLevel ??= level;
  console.log(
    `${type.padEnd(9)} Rd ${(voiceRd() - 3 * channels.tension).toFixed(2)} noise re pulses ${db(rms(noise) / rms(pulses)).toFixed(1)} dB, pulses ${(level - modalLevel).toFixed(1)} dB re modal, ${crossings} periods in 1 s`
  );
}
