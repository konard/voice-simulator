// Moving vowels of the test `tracks moving vowels` (aɪ, ɔɪ, ju, wi; male,
// female and child at 16000 Hz, waveguide, seed 1): largest F2 step inside
// the spoken part, mean |F2 error| (%) on the vowel frames against the
// planned formants, and the same with the tract length of the head given
// (`fixed`), plus the error per tenth of the vowel frames, to see where in
// the glide the error sits. Rows `slow`: the male head at pitch 70 Hz with
// the word stretched to 1 s, where neither harmonics nor the speed of the
// glide can bias the track, so what is left is the distance of the
// rendered vowels from tubeFormants (the `renderer formants` lines of
// experiments/issue-11-audit-m4a.txt).
// Run: node experiments/issue-60-moving.mjs > experiments/issue-60-moving.txt
import {
  analyzeFrames,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackFormants,
} from '../src/index.js';
import { plannedFormants } from '../tests/helpers/recognition-truth.js';

for (const word of ['aɪ', 'ɔɪ', 'ju', 'wi']) {
  for (const preset of ['male', 'female', 'child', 'slow']) {
    const slow = preset === 'slow';
    const head = slow
      ? { ...presetHeadConfig('male'), pitch: 70 }
      : presetHeadConfig(preset);
    const plan = planUtterance(
      word,
      slow ? { head, durations: [1] } : { head }
    );
    const samples = renderPlan(plan, {
      head,
      solver: 'waveguide',
      sampleRate: 16000,
      seed: 1,
    });
    const frames = analyzeFrames(samples, 16000);
    const line = [];
    for (const options of [{}, { vocalTractLength: head.vocalTractLength }]) {
      const track = trackFormants(frames, options);
      const truth = plannedFormants(plan, head, track.hop, track.count);
      const errors = [];
      for (let t = 0; t < track.count; t++) {
        if (truth.mask[t]) {
          const f2 = track.valid[t * 4 + 1] ? track.frequency[t * 4 + 1] : 0;
          errors.push(
            (100 * (f2 - truth.formants[t][1])) / truth.formants[t][1]
          );
        }
      }
      const mean = errors.reduce((s, x) => s + Math.abs(x), 0) / errors.length;
      const tenths = Array.from({ length: 10 }, (_, i) => {
        const part = errors.slice(
          Math.floor((i * errors.length) / 10),
          Math.floor(((i + 1) * errors.length) / 10)
        );
        return (part.reduce((s, x) => s + x, 0) / part.length).toFixed(0);
      });
      line.push(
        `${options.vocalTractLength ? 'fixed' : 'estimated'} L ${track.vocalTractLength.toFixed(2)} F2 ${mean.toFixed(1)} % [${tenths.join(' ')}]`
      );
    }
    console.log(`${word} ${preset}: ${line.join('; ')}`);
  }
}
