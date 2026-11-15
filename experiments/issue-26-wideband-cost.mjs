// Where does the time of `wideband` go compared with `minimal`? Both run the
// same 22-section waveguide; they differ in output rate, blockSize and the
// band limit. Interleaved rounds, median load per variant.
// Usage: node experiments/issue-26-wideband-cost.mjs [rounds] [seconds]
import { AUDIO_TIERS, measureAudioTier } from '../src/index.js';

const rounds = Number(process.argv[2] ?? 9);
const seconds = Number(process.argv[3] ?? 2);
const minimal = AUDIO_TIERS.find((tier) => tier.name === 'minimal');
const wideband = AUDIO_TIERS.find((tier) => tier.name === 'wideband');
const variants = [
  minimal,
  wideband,
  { ...wideband, name: 'wideband blockSize 32', blockSize: 32 },
  { ...wideband, name: 'wideband no bandLimit', bandLimit: undefined },
  {
    ...wideband,
    name: 'wideband blockSize 32 no bandLimit',
    blockSize: 32,
    bandLimit: undefined,
  },
  { ...minimal, name: 'minimal blockSize 24', blockSize: 24 },
  { ...minimal, name: 'minimal bandLimit 7000', bandLimit: 7000 },
];
for (const tier of variants) {
  measureAudioTier(tier, { seconds });
}
const loads = variants.map(() => []);
for (let round = 0; round < rounds; round++) {
  variants.forEach((tier, index) =>
    loads[index].push(measureAudioTier(tier, { seconds }))
  );
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[values.length >> 1];
const base = median(loads[0]);
variants.forEach((tier, index) => {
  const value = median(loads[index]);
  console.log(
    `${tier.name.padEnd(36)} ${value.toFixed(4)}  / minimal ${(value / base).toFixed(3)}`
  );
});
