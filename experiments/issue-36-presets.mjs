/**
 * Issue 36: tube formants of the measured vowels on the mid-size head of
 * each preset against Hillenbrand et al. (1995), as in
 * tests/head-presets.test.js, with the largest log errors.
 *
 * Run: node experiments/issue-36-presets.mjs [walls|rigid]
 */
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const walls = process.argv[2] !== 'rigid';
for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  const errors = [];
  for (const [vowel, [height, backness, rounding]] of Object.entries(
    STORY_FEATURES
  )) {
    const shape = tractShape({ height, backness, rounding }, head);
    const formants = tubeFormants(shape.areas, shape.length, {
      count: 3,
      walls,
      branches: [piriformBranch(shape.areas.length, shape.length, head)],
    });
    HILLENBRAND[preset][vowel].forEach((target, index) => {
      errors.push({
        vowel,
        formant: index + 1,
        value: formants[index],
        target,
        error: Math.log(formants[index] / target),
      });
    });
  }
  const rms = Math.sqrt(
    errors.reduce((sum, { error }) => sum + error * error, 0) / errors.length
  );
  const worst = [...errors]
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
    .slice(0, 4)
    .map(
      ({ vowel, formant, value, target, error }) =>
        `[${vowel}] F${formant} ${value.toFixed(0)}/${target} (${error.toFixed(3)})`
    );
  console.log(`${preset}: rms ${rms.toFixed(4)}, worst ${worst.join(', ')}`);
}
