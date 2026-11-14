// Issue 32: tune BREATH_GAIN and BREATH_EXPONENT. Prints, for candidate
// pairs, the level of the breath noise against the pulses at the source
// (as part 1 of experiments/issue-11-audit-m2.mjs: 800 Hz band-passed
// noise, 120 Hz, tenseness 0.6, 48 kHz, 1 s) for breathiness 0.2, 0.5, 1.
// The noise gain is linear in the gain, so the level for any gain follows
// from the level measured with gain 1.
// Run: node experiments/issue-32-breath-tuning.mjs > experiments/issue-32-breath-tuning.txt
import {
  Glottis,
  BREATH_GAIN,
  BREATH_EXPONENT,
} from '../src/acoustics/glottis.js';
import { Biquad, createNoise } from '../src/acoustics/filters.js';

const RATE = 48000;
const control = { f0: 120, voicing: 1, aspiration: 0, closure: 0, loudness: 1 };
const rms = (values) =>
  Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) / values.length
  );

/** Pulse RMS and noise RMS (current constants) for one breathiness. */
function levels(breathiness) {
  const clean = new Glottis({ seed: 1, tenseness: 0.6, breathiness });
  const breathy = new Glottis({ seed: 1, tenseness: 0.6, breathiness });
  const white = createNoise('m2:noise');
  const band = new Biquad();
  band.bandpass(800, 0.5, RATE);
  const pulses = new Float64Array(RATE);
  const noise = new Float64Array(RATE);
  for (let index = 0; index < RATE; index++) {
    const sample = band.process(white());
    pulses[index] = clean.step(1 / RATE, control, 0);
    noise[index] = breathy.step(1 / RATE, control, sample) - pulses[index];
  }
  return { pulses: rms(pulses), noise: rms(noise) };
}

const points = [0.2, 0.5, 1];
// Noise RMS per unit of breath gain (independent of the constants).
const measured = points.map((breathiness) => {
  const { pulses, noise } = levels(breathiness);
  const gain = BREATH_GAIN * breathiness ** BREATH_EXPONENT;
  return { breathiness, pulses, unitNoise: noise / gain };
});
console.log(
  'pulse RMS:',
  measured.map((m) => `${m.breathiness}: ${m.pulses.toFixed(4)}`).join(', ')
);
for (const exponent of [2.15, 2.25, 2.3, 2.35, 2.4]) {
  for (const gain of [2.2, 2.6, 2.8, 3, 3.2]) {
    const dB = measured.map((m) => {
      const noise = m.unitNoise * gain * m.breathiness ** exponent;
      return (20 * Math.log10(noise / m.pulses)).toFixed(2);
    });
    console.log(
      `exponent ${exponent} gain ${gain}: ${dB.join(' / ')} dB` +
        ` (0.2 gives ${(gain * 0.2 ** exponent).toFixed(4)}, before 0.07)`
    );
  }
}
