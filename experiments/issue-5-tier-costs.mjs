// Measures the load of every audio tier (after a warm-up render) to
// calibrate the relative `cost` values in src/perf/lod.js. Costs are
// relative to `minimal` (cost 1); the narrow-band tiers below it cost less.
// Usage: node experiments/issue-5-tier-costs.mjs [seconds]
//
// The waveguide tiers render the benchmark utterance in about 30 ms, so
// one render is at the mercy of the scheduler and the garbage collector
// (issue 26: single renders of the same tier differed by a factor of 2 on
// a busy machine). They are measured ROUNDS times, interleaved, and the
// median is taken; the 3D tiers, which take seconds, once.
import { AUDIO_TIERS, measureAudioTier } from '../src/index.js';

const ROUNDS = 7;
const seconds = Number(process.argv[2] ?? 1);
const cheap = (tier) => tier.solver === 'waveguide';
// Warm-up: the cheap tiers over the whole measured length, so that the
// first of them is not measured with code that is not yet optimized.
for (const tier of AUDIO_TIERS) {
  measureAudioTier(tier, { seconds: cheap(tier) ? seconds : 0.1 });
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const runs = AUDIO_TIERS.map(() => []);
for (let round = 0; round < ROUNDS; round++) {
  AUDIO_TIERS.forEach((tier, index) => {
    if (cheap(tier)) {
      runs[index].push(measureAudioTier(tier, { seconds }));
    }
  });
}
AUDIO_TIERS.forEach((tier, index) => {
  if (!cheap(tier)) {
    runs[index].push(measureAudioTier(tier, { seconds }));
  }
});
const loads = runs.map(median);
const base = loads[AUDIO_TIERS.findIndex((tier) => tier.name === 'minimal')];
for (const [index, tier] of AUDIO_TIERS.entries()) {
  const cost = (loads[index] / base).toFixed(2);
  console.log(
    tier.name,
    loads[index].toFixed(4),
    'relative cost',
    cost,
    'current',
    tier.cost
  );
}
