// Issue 51: F1-F2 of the tube model of [u] for backGap 0.2/0.4/0.6, the
// true size of the backGap effect without the LPC grid.
// Usage: node experiments/issue-51-back-gap-tube.mjs
import { tractShape } from '../src/articulation/tract-shape.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const [height, backness, rounding] = STORY_FEATURES.u;
for (const backGap of [0.2, 0.4, 0.6]) {
  const head = normalizeHeadConfig({ backGap });
  const shape = tractShape({ height, backness, rounding, rhotic: 0 }, head);
  const formants = tubeFormants(shape.areas, shape.length, { count: 3 });
  console.log('backGap', backGap, 'jaw', shape.jaw?.toFixed?.(3) ?? '', 'formants', formants.map((f) => (f.frequency ?? f).toFixed?.(1) ?? JSON.stringify(f)).join(' '));
}
