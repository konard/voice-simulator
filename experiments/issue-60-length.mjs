// Tract length estimate of trackFormants for a male head with the length
// overridden (the test `estimates the tract length`), against the median
// tractLengthFromFormants of the planned formants (tubeFormants of the
// planned area function, vowel frames with a closed velum) and the median
// planned shape length.
// Run: node experiments/issue-60-length.mjs > experiments/issue-60-length.txt
import {
  analyzeFrames,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  textToIpa,
  trackFormants,
  tractLengthFromFormants,
} from '../src/index.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { tubeFormants } from '../src/acoustics/transfer.js';

const TEXT =
  process.argv[2] ??
  'The north wind and the sun were disputing which was the stronger.';
const median = (list) => {
  const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
for (const preset of ['male', 'female']) {
  for (const length of [13, 14, 15, 16.5, 18, 19]) {
    const head = { ...presetHeadConfig(preset), vocalTractLength: length };
    const plan = planUtterance(textToIpa(TEXT).ipa, { head });
    const samples = renderPlan(plan, {
      head,
      solver: 'waveguide',
      sampleRate: 16000,
      seed: 1,
    });
    const frames = analyzeFrames(samples, 16000);
    const track = trackFormants(frames);
    // Vowel frames; the English vowels of TEXT have the velum a little open
    // (coarticulation), so the planned formants are those of the oral tube.
    const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
    const mask = Array.from({ length: track.count }, (_, t) =>
      vowels.some(
        (segment) =>
          t * track.hop >= segment.start && t * track.hop < segment.end
      )
    );
    const planned = [];
    const shapes = [];
    const tracked = [];
    const state = {};
    for (let t = 0; t < track.count; t++) {
      if (!mask[t]) {
        continue;
      }
      sampleState(plan, t * track.hop, state);
      const shape = tractShape(state, head);
      const [f1, f2, f3] = tubeFormants(shape.areas, shape.length);
      planned.push(tractLengthFromFormants(f1, f2, f3));
      shapes.push(shape.length);
      if (
        track.valid[t * 4] &&
        track.valid[t * 4 + 1] &&
        track.valid[t * 4 + 2]
      ) {
        tracked.push(
          tractLengthFromFormants(
            track.frequency[t * 4],
            track.frequency[t * 4 + 1],
            track.frequency[t * 4 + 2]
          )
        );
      }
    }
    const fixed = trackFormants(frames, { vocalTractLength: length });
    const fixedVowels = [];
    for (let t = 0; t < fixed.count; t++) {
      if (
        mask[t] &&
        fixed.valid[t * 4] &&
        fixed.valid[t * 4 + 1] &&
        fixed.valid[t * 4 + 2]
      ) {
        fixedVowels.push(
          tractLengthFromFormants(
            fixed.frequency[t * 4],
            fixed.frequency[t * 4 + 1],
            fixed.frequency[t * 4 + 2]
          )
        );
      }
    }
    console.log(
      `${preset} L ${length}: estimate ${track.vocalTractLength.toFixed(2)}, ` +
        `vowel frames: planned ${median(planned).toFixed(2)}, shape ${median(shapes).toFixed(2)}, ` +
        `tracked ${median(tracked).toFixed(2)}, tracked with L fixed ${median(fixedVowels).toFixed(2)}`
    );
  }
}
