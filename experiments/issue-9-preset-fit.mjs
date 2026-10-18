// Fit the mid-size anatomy of a head preset so that the tube formants of the
// measured vowels (piriform fossae included) match the Hillenbrand et al.
// (1995) means of that group, by a bounded pattern search on the log
// formant error. The bounds keep every value anatomically plausible.
// Usage: node experiments/issue-9-preset-fit.mjs female|child [--keys a,b]
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const preset = process.argv[2] ?? 'female';
const keysIndex = process.argv.indexOf('--keys');
// Fant (1966) and Fitch and Giedd (1999): the female pharynx is about 0.8
// and the oral cavity about 0.9 of the male one, so with a male ratio of 0.5
// the female pharynx ratio is about 0.47; it is lower still before puberty.
// The tongue, jaw and lips stay near the proportions of an adult.
const BOUNDS = {
  vocalTractLength: [12, 18],
  pharynxRatio: [0.42, 0.52],
  pharynxWidth: [0.7, 1.15],
  oralWidth: [0.75, 1.08],
  mouthWidth: [0.85, 1.1],
  lipThickness: [0.9, 1.1],
  jawRange: [0.9, 1.06],
  tongueSize: [0.95, 1.08],
};
const keys =
  keysIndex >= 0 ? process.argv[keysIndex + 1].split(',') : Object.keys(BOUNDS);

export function presetError(head, group) {
  const errors = [];
  for (const [vowel, [height, backness, rounding]] of Object.entries(
    STORY_FEATURES
  )) {
    const shape = tractShape({ height, backness, rounding }, head);
    const formants = tubeFormants(shape.areas, shape.length, {
      count: 3,
      branches: [piriformBranch(shape.areas.length, shape.length, head)],
    });
    HILLENBRAND[group][vowel].forEach((target, index) =>
      errors.push(Math.log((formants[index] ?? Infinity) / target))
    );
  }
  return Math.sqrt(
    errors.reduce((sum, value) => sum + value * value, 0) / errors.length
  );
}

let head = { ...presetHeadConfig(preset) };
let best = presetError(head, preset);
console.log(`start rms ${(100 * best).toFixed(2)}%`);
let scale = 0.25;
while (scale > 0.004) {
  let improved = false;
  for (const key of keys) {
    const [low, high] = BOUNDS[key];
    for (const sign of [1, -1]) {
      const value = Math.min(
        high,
        Math.max(low, head[key] + sign * scale * (high - low))
      );
      const trial = { ...head, [key]: value };
      const error = presetError(trial, preset);
      if (error < best - 1e-6) {
        head = trial;
        best = error;
        improved = true;
      }
    }
  }
  if (!improved) {
    scale /= 2;
  }
}
console.log(`fitted rms ${(100 * best).toFixed(2)}%`);
console.log(
  Object.fromEntries(keys.map((key) => [key, Number(head[key].toFixed(3))]))
);
