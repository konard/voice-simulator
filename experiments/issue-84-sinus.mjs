/**
 * Issue 84, step 6: can a maxillary sinus explain the missing murmur loss?
 *
 * The chain-matrix tube model (src/acoustics/transfer.js) of the static
 * [m] of ˈama, with the nasal branch, is evaluated with and without a
 * Helmholtz side branch on the nasal cavity (15 cm³, 0.1 cm² opening,
 * 0.6 cm neck, resonance near 500 Hz; Dang & Honda 1996). The murmur level
 * is the sum over the harmonics of f0 (averaged over 100..140 Hz) of the
 * transfer power
 * weighted with the source spectrum measured in the synthesized vowel
 * (H1 - H2 = 6.5 dB, then -8 dB per octave). The level of the waveguide
 * murmur must drop by 7.5 dB (ratio 1.19 -> 0.5) to 13.5 dB (-> 0.25).
 *
 *   node experiments/issue-84-sinus.mjs
 */
import { noseShape } from '../src/articulation/tract-shape.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { tubeTransfer } from '../src/acoustics/transfer.js';
import { lowestPeak, staticShape, tubeOptions } from './issue-84-resonance.mjs';

// Physical boundary-layer constant of sectionMatrix (viscous + thermal):
// alpha = 1.5 pi sqrt(nu) / c * sqrt(f / A), nu = 0.163 cm²/s.
const PHYSICAL_LOSS = (1.5 * Math.PI * Math.sqrt(0.163)) / 35000;
function source(harmonic) {
  if (harmonic === 1) {
    return 1;
  }
  return 10 ** (-(6.5 + 8 * Math.log2(harmonic / 2)) / 10);
}

const head = normalizeHeadConfig({});
const shape = staticShape('consonant', head);
const nose = noseShape(head);
// The maxillary ostia open into the middle meatus, about 40 % along the
// nasal cavity; one sinus on each side.
const sinusIndex = Math.round(0.4 * (nose.areas.length - 1));
const sinus = (volume) => ({
  index: sinusIndex,
  area: 0.1,
  length: 0.6,
  volume,
  loss: PHYSICAL_LOSS,
});

function murmur(noseLoss, branches) {
  const options = tubeOptions(shape, head, noseLoss);
  options.nose.branches = branches;
  // Mean over f0 = 100..140 Hz so that the result does not hinge on
  // where one harmonic falls against the narrow N1 peak.
  let power = 0;
  let count = 0;
  for (let f0 = 100; f0 <= 140; f0 += 2.5, count++) {
    for (let harmonic = 1; harmonic * f0 < 4000; harmonic++) {
      const gain = tubeTransfer(
        shape.areas,
        shape.length,
        harmonic * f0,
        options
      );
      power += source(harmonic) * gain * gain;
    }
  }
  power /= count;
  const frequencies = [];
  for (let f = 60; f <= 2000; f += 2) {
    frequencies.push(f);
  }
  const spectrum = frequencies.map(
    (f) => tubeTransfer(shape.areas, shape.length, f, options) ** 2
  );
  return {
    level: 10 * Math.log10(power),
    peak: lowestPeak(frequencies, spectrum),
  };
}

console.log(`sinus at nose section ${sinusIndex} of ${nose.areas.length}`);
for (const scale of [1, 3, 8, 30]) {
  const noseLoss = PHYSICAL_LOSS * scale;
  const bare = murmur(noseLoss, []);
  const one = murmur(noseLoss, [sinus(15)]);
  const two = murmur(noseLoss, [sinus(15), sinus(15)]);
  const fmt = ({ level, peak }) =>
    `level ${level.toFixed(1)} dB, N1 ${peak.map((v) => v.toFixed(0)).join('/')}`;
  console.log(
    `nose loss x${scale}: no sinus ${fmt(bare)} | one sinus ${fmt(one)}` +
      ` (${(one.level - bare.level).toFixed(1)} dB) | two ${fmt(two)}` +
      ` (${(two.level - bare.level).toFixed(1)} dB)`
  );
}
