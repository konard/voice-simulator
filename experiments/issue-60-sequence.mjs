// The 10 steady vowels of experiments/issue-60-vowels.mjs as one utterance
// (0.5 s each, i e ɛ a ɑ ɔ o u ə y in a row) through trackFormants with
// the tract length estimated, against the planned formants per frame, so that
// the tract length is estimated from all the vowels together.
// Run: node experiments/issue-60-sequence.mjs > experiments/issue-60-sequence.txt
import {
  analyzeFrames,
  formantErrors,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackFormants,
} from '../src/index.js';
import { plannedFormants } from '../tests/helpers/recognition-truth.js';

const VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'y'];
for (const preset of ['male', 'female', 'child']) {
  for (const rate of [16000, 8000]) {
    const head = presetHeadConfig(preset);
    const plan = planUtterance(VOWELS.map((v) => `${v}ː`).join(''), {
      head,
      durations: VOWELS.map(() => 0.5),
    });
    const samples = renderPlan(plan, {
      head,
      solver: 'waveguide',
      sampleRate: rate,
      seed: 1,
    });
    const frames = analyzeFrames(samples, rate);
    const track = trackFormants(frames);
    const truth = plannedFormants(plan, head, frames.hop, track.count);
    const reference = [];
    const test = [];
    let invalid = 0;
    let over20 = 0;
    for (let t = 0; t < track.count; t++) {
      if (!truth.mask[t]) {
        continue;
      }
      const row = [0, 1, 2].map((k) =>
        track.valid[t * 4 + k] ? track.frequency[t * 4 + k] : 0
      );
      const r = truth.formants[t].slice(0, 3);
      invalid += row.some((v) => !(v > 0)) ? 1 : 0;
      over20 += row.some((v, k) => v > 0 && Math.abs(v / r[k] - 1) > 0.2)
        ? 1
        : 0;
      reference.push(r);
      test.push(row);
    }
    const e = formantErrors(reference, test);
    console.log(
      `${preset}@${rate}: L ${track.vocalTractLength.toFixed(2)} (head ` +
        `${head.vocalTractLength}) frames ${reference.length} invalid ` +
        `${invalid} over20 ${over20} mean % ${[e.f1, e.f2, e.f3]
          .map((x) => x.percent.toFixed(1))
          .join(' ')}`
    );
  }
}
