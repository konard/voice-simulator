// Measures the load of every audio tier (after a warm-up render) to
// calibrate the relative `cost` values in src/perf/lod.js.
// Usage: node experiments/issue-5-tier-costs.mjs [seconds]
import { AUDIO_TIERS, measureAudioTier } from '../src/index.js';

const seconds = Number(process.argv[2] ?? 1);
for (const tier of AUDIO_TIERS) {
  measureAudioTier(tier, { seconds: 0.1 });
}
const loads = AUDIO_TIERS.map((tier) => measureAudioTier(tier, { seconds }));
for (const [index, tier] of AUDIO_TIERS.entries()) {
  const cost = (loads[index] / loads[0]).toFixed(2);
  console.log(
    tier.name,
    loads[index].toFixed(3),
    'relative cost',
    cost,
    'current',
    tier.cost
  );
}
