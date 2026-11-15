// Load (render time / audio time) of the waveguide tiers, interleaved and
// repeated, to see where the time of the narrow-band tiers goes.
// Usage: node experiments/issue-26-tier-loads.mjs [rounds] [seconds]
import { AUDIO_TIERS, measureAudioTier } from '../src/index.js';

const rounds = Number(process.argv[2] ?? 7);
const seconds = Number(process.argv[3] ?? 2);
const tiers = AUDIO_TIERS.filter((tier) => tier.solver === 'waveguide');
const variants = [
  ...tiers,
  ...tiers
    .filter((tier) => tier.bandLimit)
    .map((tier) => ({
      ...tier,
      name: `${tier.name} (blockSize 32)`,
      blockSize: 32,
    })),
  ...tiers
    .filter((tier) => tier.bandLimit)
    .map((tier) => ({
      ...tier,
      name: `${tier.name} (no bandLimit)`,
      bandLimit: undefined,
    })),
];
for (const tier of variants) {
  measureAudioTier(tier, { seconds: 0.3 });
}
const loads = variants.map(() => []);
for (let round = 0; round < rounds; round++) {
  variants.forEach((tier, index) =>
    loads[index].push(measureAudioTier(tier, { seconds }))
  );
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const base = median(loads[tiers.findIndex((tier) => tier.name === 'minimal')]);
variants.forEach((tier, index) => {
  const value = median(loads[index]);
  console.log(
    `${tier.name.padEnd(28)} median load ${value.toFixed(4)}  / minimal ${(
      value / base
    ).toFixed(2)}`
  );
});
