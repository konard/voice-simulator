/**
 * Measures the three departures of src/acoustics/folds.js from the literal
 * two-mass model of the issue (Steinecke and Herzel 1995):
 * 1. REST_CONVERGENCE: with equal rest areas the folds do not start from
 *    rest;
 * 2. tension scaling: d_i / Q with a fixed damping (literal) against r_i / Q
 *    with a fixed d_i (folds.js): threshold pressure, and amplitude and
 *    pitch at 800 Pa by Q;
 * 3. pressure on the closed lower mass: none (literal) against the full
 *    lung pressure (folds.js, Ishizaka and Flanagan) — the pitch near
 *    Q = 2.24 at 800 Pa.
 * The stepper below is the inner loop of VocalFolds with switches; with the
 * switches of folds.js it gives the same pitch as VocalFolds (checked first).
 *
 * Run: node experiments/issue-33-folds-variants.mjs > experiments/issue-33-folds-variants.txt
 */
import { AIR_DENSITY } from '../src/acoustics/transfer.js';
import {
  FOLD_COLLISION,
  FOLD_COUPLING,
  FOLD_DAMPING_1,
  FOLD_DAMPING_2,
  FOLD_LENGTH,
  FOLD_MASS_1,
  FOLD_MASS_2,
  FOLD_RATE,
  FOLD_STIFFNESS_1,
  FOLD_STIFFNESS_2,
  FOLD_THICKNESS_1,
  REST_CONVERGENCE,
  foldPitch,
  flowPitch,
  restArea,
} from '../src/acoustics/folds.js';

const RATE = FOLD_RATE;
const FOLDS = {
  convergence: REST_CONVERGENCE,
  scaling: 'damping',
  closed: true,
};
const LITERAL = { convergence: 0, scaling: 'thickness', closed: false };

/** Flow (cm³/s) of `duration` s at constant pressure (Pa) and tension. */
function simulate(
  variant,
  { pressure = 800, tension = 1, duration = 0.4 } = {}
) {
  const q = tension;
  const thicknessScale = variant.scaling === 'thickness' ? 1 / q : 1;
  const dampingScale = variant.scaling === 'thickness' ? 1 : 1 / q;
  const m1 = FOLD_MASS_1 / q;
  const m2 = FOLD_MASS_2 / q;
  const k1 = FOLD_STIFFNESS_1 * q;
  const k2 = FOLD_STIFFNESS_2 * q;
  const kc = FOLD_COUPLING * q;
  const r1 = FOLD_DAMPING_1 * dampingScale;
  const r2 = FOLD_DAMPING_2 * dampingScale;
  const L = FOLD_LENGTH;
  const c1 = (FOLD_COLLISION * k1) / (2 * L);
  const c2 = (FOLD_COLLISION * k2) / (2 * L);
  const ps = pressure * 10;
  const a02 = restArea(0.5);
  const a01 = a02 + variant.convergence;
  const drive = L * FOLD_THICKNESS_1 * thicknessScale * ps;
  const h = 1 / RATE;
  const length = Math.round(duration * RATE);
  const flow = new Float64Array(length);
  let x1 = 0;
  let x2 = 0;
  let v1 = 0;
  let v2 = 0;
  for (let index = 0; index < length; index++) {
    const a1 = a01 + 2 * L * x1;
    const a2 = a02 + 2 * L * x2;
    let f1 = -r1 * v1 - k1 * x1 - kc * (x1 - x2);
    let f2 = -r2 * v2 - k2 * x2 - kc * (x2 - x1);
    if (a1 > 0) {
      const ratio = Math.max(0, Math.min(a1, a2)) / a1;
      f1 += drive * (1 - ratio * ratio);
    } else {
      f1 += (variant.closed ? drive : 0) - c1 * a1;
    }
    if (a2 < 0) {
      f2 -= c2 * a2;
    }
    v1 += (h * f1) / m1;
    v2 += (h * f2) / m2;
    x1 += h * v1;
    x2 += h * v2;
    const area = Math.max(0, Math.min(a01 + 2 * L * x1, a02 + 2 * L * x2));
    flow[index] = area * Math.sqrt((2 * ps) / AIR_DENSITY);
  }
  return flow;
}

const tail = (flow) => flow.subarray(flow.length - Math.round(0.1 * RATE));
const peakToPeak = (values) => Math.max(...values) - Math.min(...values);
const pitch = (variant, options) =>
  flowPitch(tail(simulate(variant, { duration: 0.15, ...options })), RATE);

/**
 * Lowest pressure (25 Pa steps up to 3000 Pa) whose p2p flow in 0.3-0.4 s
 * is at least 1 % of that at 800 Pa and Q = 1.
 */
function threshold(variant, tension) {
  const reference = peakToPeak(tail(simulate(variant)));
  for (let pressure = 25; pressure <= 3000; pressure += 25) {
    const flow = tail(simulate(variant, { pressure, tension }));
    if (peakToPeak(flow) >= 0.01 * reference) {
      return pressure;
    }
  }
  return Number.NaN;
}

console.log(
  'Check: this stepper with the switches of folds.js against VocalFolds'
);
for (const tension of [0.5, 1, 2, 4]) {
  console.log(
    `  Q ${tension}: ${pitch(FOLDS, { tension }).toFixed(3)} Hz, VocalFolds ${foldPitch(800, tension).toFixed(3)} Hz`
  );
}

console.log('');
console.log(
  '1. Start from rest at 800 Pa, Q = 1, adduction 0.5: p2p flow in 0.3-0.4 s (cm³/s)'
);
for (const convergence of [0, REST_CONVERGENCE]) {
  const flow = tail(simulate({ ...FOLDS, convergence }));
  console.log(
    `  rest convergence ${convergence} cm²: ${peakToPeak(flow).toExponential(3)}`
  );
}

console.log('');
console.log(
  '2. Tension scaling at adduction 0.5: threshold, and at 800 Pa the p2p flow'
);
console.log(
  '   in 0.3-0.4 s as a share of Q = 1 and the pitch ("-" below 1 %)'
);
console.log('  Q     literal (d/Q, r fixed)       folds.js (r/Q, d fixed)');
for (const tension of [0.5, 1, 1.5, 2, 2.5, 2.6, 3, 4]) {
  const cells = [LITERAL, FOLDS].map((variant) => {
    const base = { ...variant, closed: true, convergence: REST_CONVERGENCE };
    const reference = peakToPeak(tail(simulate(base)));
    const flow = tail(simulate(base, { tension }));
    const share = peakToPeak(flow) / reference;
    const value = threshold(base, tension);
    const shown = Number.isNaN(value) ? '> 3000' : `${value} Pa`;
    const hz = share >= 0.01 ? `${flowPitch(flow, RATE).toFixed(1)} Hz` : '-';
    return `${shown.padStart(7)} ${share.toFixed(3)} ${hz.padStart(8)}`.padEnd(
      28
    );
  });
  console.log(`  ${String(tension).padEnd(5)} ${cells.join(' ')}`.trimEnd());
}

console.log('');
console.log('3. Pressure on the closed lower mass: pitch (Hz) at 800 Pa by Q');
console.log('  Q      none (literal)  full (folds.js)');
for (let tension = 2.18; tension <= 2.305; tension += 0.01) {
  const cells = [false, true].map((closed) =>
    pitch({ ...FOLDS, closed }, { tension })
      .toFixed(1)
      .padStart(14)
  );
  console.log(`  ${tension.toFixed(2)}  ${cells.join('  ')}`);
}
