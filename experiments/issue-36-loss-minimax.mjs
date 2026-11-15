// Issue 36: best first-order fit of the loss K sqrt(f) over 250-8000 Hz
// (smallest largest relative error on a log grid), small-K limit:
// loss(f) = C + D (a + cos w) / (1 + a^2 + 2 a cos w).
// Run: node experiments/issue-36-loss-minimax.mjs [rate]
const RATE = Number(process.argv[2] ?? 48000);
const GRID = Array.from({ length: 61 }, (_, i) => 250 * 32 ** (i / 60));

function worst(a, C, D, rate) {
  let max = 0;
  for (const f of GRID) {
    const c = Math.cos((2 * Math.PI * f) / rate);
    const loss = C + (D * (a + c)) / (1 + a * a + 2 * a * c);
    max = Math.max(max, Math.abs(loss / Math.sqrt(f) - 1));
  }
  return max;
}

let best = { error: Infinity };
for (let a = -0.99; a <= 0.99; a += 0.02) {
  // For fixed a the shape h(f) is known; search C, D on a coarse then fine grid.
  for (let C = -100; C <= 100; C += 1) {
    for (let D = -200; D <= 200; D += 1) {
      const error = worst(a, C, D, RATE);
      if (error < best.error) {
        best = { error, a, C, D };
      }
    }
  }
}
console.log(`rate ${RATE}: best first-order minimax`, best);
