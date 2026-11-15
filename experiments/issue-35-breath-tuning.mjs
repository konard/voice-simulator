// Issue 35: tune BREATH_GAIN and BREATH_EXPONENT for breath noise that is
// scaled by the turbulence source strength at the glottis
// (src/acoustics/aerodynamics.js). Measures, as
// part 1 of experiments/issue-11-audit-m2.mjs (800 Hz band-passed noise,
// 120 Hz, tenseness 0.6, 48 kHz, 1 s), the breath noise against the pulses
// at the source for breathiness 0.2, 0.5 and 1. The noise is linear in
// BREATH_GAIN * breathiness ** BREATH_EXPONENT, so the gain and exponent
// that keep the levels of main at breathiness 0.2 and 1 (-40.19 and
// -10.11 dB) follow from one measurement.
// Run: node experiments/issue-35-breath-tuning.mjs > experiments/issue-35-breath-tuning.txt
import {
  Glottis,
  BREATH_GAIN,
  BREATH_EXPONENT,
} from '../src/acoustics/glottis.js';
import { Biquad, createNoise } from '../src/acoustics/filters.js';

const RATE = 48000;
const TARGETS = { 0.2: -40.19, 1: -10.11 };
const control = { f0: 120, voicing: 1, aspiration: 0, closure: 0, loudness: 1 };
const rms = (values) =>
  Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) / values.length
  );

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

// Level (dB) of the noise per unit of breath gain against the pulses.
const unit = new Map(
  [0.2, 0.5, 1].map((breathiness) => {
    const { pulses, noise } = levels(breathiness);
    const gain = BREATH_GAIN * breathiness ** BREATH_EXPONENT;
    return [breathiness, 20 * Math.log10(noise / gain / pulses)];
  })
);
const show = (label, gain, exponent) =>
  console.log(
    `${label} gain ${gain} exponent ${exponent}: ${[...unit]
      .map(
        ([breathiness, level]) =>
          `${breathiness}: ${(level + 20 * Math.log10(gain * breathiness ** exponent)).toFixed(2)} dB`
      )
      .join(', ')}`
  );
const gain = 10 ** ((TARGETS[1] - unit.get(1)) / 20);
const exponent =
  (TARGETS[0.2] - unit.get(0.2) - 20 * Math.log10(gain)) /
  (20 * Math.log10(0.2));
console.log(
  `targets: breathiness 0.2: ${TARGETS[0.2]} dB, 1: ${TARGETS[1]} dB (main)`
);
show('solved', gain.toFixed(4), exponent.toFixed(4));
show('rounded', Number(gain.toFixed(2)), Number(exponent.toFixed(3)));
show('current', BREATH_GAIN, BREATH_EXPONENT);
