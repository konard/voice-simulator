// gridFormants of tests/helpers/recognition-truth.js (a 25 Hz scan refined
// on the 5 Hz grid) against tubeFormants (the 5 Hz grid of tubeSpectrum)
// on every frame of the planned vowels of the issue-60 tests: the steady
// vowel sequence and the moving vowels aɪ ɔɪ ju wi, for the three presets.
// Run: node experiments/issue-60-truth.mjs > experiments/issue-60-truth.txt
import { planUtterance, presetHeadConfig } from '../src/index.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { gridFormants } from '../tests/helpers/recognition-truth.js';

const VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'y'];
const texts = [
  [VOWELS.map((vowel) => `${vowel}ː`).join(''), VOWELS.map(() => 0.5)],
  ['aɪ'],
  ['ɔɪ'],
  ['ju'],
  ['wi'],
];
let frames = 0;
let mismatched = 0;
let worst = 0;
let fineTime = 0;
let gridTime = 0;
for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  for (const [text, durations] of texts) {
    const plan = planUtterance(
      text,
      durations ? { head, durations } : { head }
    );
    const state = {};
    const end = (plan.frameCount - 1) / plan.frameRate;
    for (let time = 0; time < end; time += 0.005) {
      sampleState(plan, time, state);
      const shape = tractShape(state, head);
      let started = globalThis.performance.now();
      const fine = tubeFormants(shape.areas, shape.length);
      fineTime += globalThis.performance.now() - started;
      started = globalThis.performance.now();
      const grid = gridFormants(shape.areas, shape.length);
      gridTime += globalThis.performance.now() - started;
      frames++;
      const gap =
        fine.length === grid.length
          ? Math.max(...fine.map((f, k) => Math.abs(f - grid[k])))
          : Infinity;
      worst = Math.max(worst, gap);
      if (gap > 1e-9) {
        mismatched++;
        console.log(
          `${preset} ${text} ${time.toFixed(3)}: ${fine.map((f) => f.toFixed(2))} | ${grid.map((f) => f.toFixed(2))}`
        );
      }
    }
  }
}
console.log(
  `frames ${frames}, mismatched ${mismatched}, worst gap ${worst} Hz, ` +
    `tubeFormants ${(fineTime / 1000).toFixed(1)} s, gridFormants ${(gridTime / 1000).toFixed(1)} s`
);
