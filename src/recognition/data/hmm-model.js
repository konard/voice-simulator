/** Gaussian HMM states trained on the simulator's own renders, packed by
 * node scripts/build-hmm-model.mjs (training: tests/heavy/README.md,
 * "Recognition model"). Unlicense. */
import part0 from './hmm-model-0.js';
import part1 from './hmm-model-1.js';
import part2 from './hmm-model-2.js';

export const HMM_MODEL = JSON.parse(part0 + part1 + part2);
