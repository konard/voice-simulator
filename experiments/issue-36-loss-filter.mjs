// Issue 36: how well can a first-order filter follow the wall loss
// exp(-K sqrt(f))? (a) the one-pole y = b0 x - a1 y[n-1] matched at 500 and
// 4000 Hz, as the issue first proposed; (b) a one-pole one-zero shelf
// y = b0 x + b1 x[n-1] - a1 y[n-1], matched at the same two frequencies, its
// pole chosen for the smallest largest error from 250 to 8000 Hz.
// Run: node experiments/issue-36-loss-filter.mjs
const RATE = Number(process.argv[2] ?? 48000);
const CHECK = [250, 500, 1000, 2000, 4000, 8000];

function gain({ b0, b1 = 0, a1 }, f, rate) {
  const w = (2 * Math.PI * f) / rate;
  const nr = b0 + b1 * Math.cos(w);
  const ni = -b1 * Math.sin(w);
  const dr = 1 + a1 * Math.cos(w);
  const di = -a1 * Math.sin(w);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

function onePole(K, rate) {
  const [f1, f2] = [500, 4000];
  const q1 = Math.exp(2 * K * Math.sqrt(f1));
  const q2 = Math.exp(2 * K * Math.sqrt(f2));
  const c1 = Math.cos((2 * Math.PI * f1) / rate);
  const c2 = Math.cos((2 * Math.PI * f2) / rate);
  const a = q2 - q1;
  const b = 2 * c1 * (q2 - q1) - 2 * q1 * (c2 - c1);
  const a1 = (-b + Math.sqrt(b * b - 4 * a * a)) / (2 * a);
  const b0 = Math.sqrt((1 + a1 * a1 + 2 * a1 * c1) / q1);
  return { b0, a1 };
}

function errors(filter, K, rate) {
  return CHECK.map((f) => {
    const loss = -Math.log(gain(filter, f, rate));
    const target = K * Math.sqrt(f);
    return (loss - target) / target;
  });
}

for (const K of [2e-5, 1e-4, 5e-4]) {
  console.log(
    `one-pole K ${K}: relative loss error at ${CHECK.join('/')} Hz:`,
    errors(onePole(K, RATE), K, RATE)
      .map((e) => `${(100 * e).toFixed(1)}%`)
      .join(' ')
  );
}

/** Shelf with pole -a1 matched at 500 and 4000 Hz. */
function shelf(K, rate, a1) {
  const [f1, f2] = [500, 4000];
  const t1 = Math.exp(-2 * K * Math.sqrt(f1));
  const t2 = Math.exp(-2 * K * Math.sqrt(f2));
  const c1 = Math.cos((2 * Math.PI * f1) / rate);
  const c2 = Math.cos((2 * Math.PI * f2) / rate);
  const d1 = 1 + a1 * a1 + 2 * a1 * c1;
  const d2 = 1 + a1 * a1 + 2 * a1 * c2;
  const rho = (t2 / t1) * (d2 / d1);
  const a = 1 - rho;
  const b = 2 * (c2 - rho * c1);
  const disc = b * b - 4 * a * a;
  if (disc < 0) return null;
  const roots = [
    (-b + Math.sqrt(disc)) / (2 * a),
    (-b - Math.sqrt(disc)) / (2 * a),
  ];
  const beta = roots.find((r) => Math.abs(r) <= 1);
  const g = Math.sqrt((t1 * d1) / (1 + beta * beta + 2 * beta * c1));
  return { b0: g, b1: g * beta, a1 };
}

for (const rate of [RATE, 90000]) {
  for (const K of [2e-5, 1e-4, 5e-4]) {
    let best = null;
    for (let a1 = -0.999; a1 < 0.999; a1 += 0.0005) {
      const filter = shelf(K, rate, a1);
      if (!filter) continue;
      const worst = Math.max(...errors(filter, K, rate).map(Math.abs));
      if (!best || worst < best.worst) best = { worst, filter };
    }
    console.log(
      `shelf rate ${rate} K ${K}: a1 ${best.filter.a1.toFixed(4)} b1/b0 ${(best.filter.b1 / best.filter.b0).toFixed(4)} errors`,
      errors(best.filter, K, rate)
        .map((e) => `${(100 * e).toFixed(1)}%`)
        .join(' ')
    );
  }
}
