// Issue 40: F1-F3 of a 3D-calibrated vowel as its length coefficient moves,
// with the source plane following the length (VOWEL_LENGTH_SCALE_3D).
// Usage: node experiments/issue-40-vowel-length.mjs --solver fdtd3d [vowel...]
import { solverFormants } from '../scripts/calibrate-vowels.mjs';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';

const names = process.argv.slice(2).filter((arg) => arg in HILLENBRAND.male);
for (const name of names.length ? names : ['i', 'ɔ']) {
  console.log(`/${name}/ target ${HILLENBRAND.male[name].join(' ')}`);
  for (const shift of [-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12]) {
    const coefficients = [...VOWEL_CORRECTIONS_3D[name]];
    coefficients[0] += shift;
    const formants = solverFormants(name, { [name]: coefficients });
    console.log(
      `  c0 ${coefficients[0].toFixed(4)}: ${formants.map(Math.round).join(' ')}`
    );
  }
}
