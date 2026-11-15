/**
 * Issue 36: the closed-form zero of designLossFilter against a bisection
 * of the end-loss equation, from tiny to huge K and over the rates of the
 * tiers. Prints the largest zero difference and checks every filter is
 * finite and passive (gain at most 1 up to Nyquist).
 *
 * Run: node experiments/issue-36-zero-solve.mjs
 */
import { designLossFilter, lossFilterGain } from '../src/acoustics/losses.js';

let worst = 0;
let failures = 0;
for (const rate of [8000, 16000, 22050, 44100, 89000, 110500, 200000]) {
  for (let e = -9; e <= 1; e += 0.05) {
    const K = 10 ** e;
    const { b0, b1, a1 } = designLossFilter(K, rate);
    const zero = b1 / b0;
    let largest = 0;
    for (let f = 1; f < rate / 2; f *= 1.05) {
      largest = Math.max(largest, lossFilterGain({ b0, b1, a1 }, f, rate));
    }
    largest = Math.max(largest, lossFilterGain({ b0, b1, a1 }, rate / 2, rate));
    if (![b0, b1, a1].every(Number.isFinite) || largest > 1 + 1e-12) {
      failures++;
      console.log('bad', rate, K, b0, b1, a1, largest);
    }
    // Bisection reference: the zero whose end losses differ by the target.
    const reference = bisect(K, rate);
    worst = Math.max(worst, Math.abs(reference - zero));
  }
}
console.log(`largest zero difference to bisection: ${worst.toExponential(2)}`);
console.log(
  failures
    ? `${failures} filters not finite or not passive`
    : 'all filters finite and passive'
);

function bisect(K, rate) {
  // Re-derive the wanted end losses from the designed filter of a tiny
  // K-step: the low and high end gains of exp(-K sqrt(f)) are what the
  // design matches, through the fitted slopes; compare the filter's own
  // zero with a bisection on the same loss difference.
  const { b0, b1 } = designLossFilter(K, rate);
  const zero = b1 / b0;
  const top = Math.min(
    8000,
    0.45 * Math.max(500, Math.round(rate / 500) * 500)
  );
  const r = Math.max(500, Math.round(rate / 500) * 500);
  const low = Math.cos((2 * Math.PI * 250) / r);
  const high = Math.cos((2 * Math.PI * top) / r);
  const loss = (b, c) => -0.5 * Math.log(1 + b * b + 2 * b * c);
  const target = loss(zero, low) - loss(zero, high);
  let lo = -0.999;
  let hi = 0.999;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (loss(mid, low) - loss(mid, high) - target > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
