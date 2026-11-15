// Issue 36: check losses.js against the numbers the issue quotes.
// Run: node experiments/issue-36-loss-check.mjs
import {
  designLossFilter,
  lossFilterGain,
  publishedBandwidth,
  viscothermalLoss,
} from '../src/acoustics/losses.js';

for (const f of [358, 814, 2718]) {
  console.log(`publishedBandwidth(${f}) = ${publishedBandwidth(f).toFixed(1)} Hz`);
}
console.log(`viscothermalLoss(500, 3) = ${viscothermalLoss(500, 3).toExponential(3)}`);
for (const rate of [48000, 90000]) {
  for (const K of [2e-5, 1e-4, 5e-4]) {
    const filter = designLossFilter(K, rate);
    const errors = [250, 500, 1000, 2000, 4000, 8000].map((f) => {
      const loss = -Math.log(lossFilterGain(filter, f, rate));
      return `${f}:${((100 * (loss - K * Math.sqrt(f))) / (K * Math.sqrt(f))).toFixed(1)}%`;
    });
    console.log(`rate ${rate} K ${K}: a1 ${filter.a1.toFixed(3)} ${errors.join(' ')}`);
  }
}
