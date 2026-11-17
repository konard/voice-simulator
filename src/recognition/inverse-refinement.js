/** Stationary LF/tract least squares refinement (Unlicense).
 * IAIF may assign smooth source poles to a high-order tract predictor. For
 * stationary phonation only, project the known LF family and the speech onto
 * the same lagged-speech design matrix. The residual correlation eliminates
 * the unknown tract and gain. This is an open-phase fit, not closed-phase LPC.
 * See docs/INVERSE-FILTER.md for the objective, safeguards and limits. */
import { lfParameters, lfWaveform } from '../acoustics/glottis.js';
let pulses;
function templates() {
  return (pulses ??= Array.from({ length: 38 }, (_, i) => {
    const p = lfParameters(0.1 + i * 0.02);
    return {
      p,
      table: Float64Array.from({ length: 4096 }, (_, n) =>
        lfWaveform(p, n / 4096)
      ),
    };
  }));
}
function solve(l, b, p) {
  const y = new Float64Array(p),
    a = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let v = b[i];
    for (let j = 0; j < i; j++) {
      v -= l[i * p + j] * y[j];
    }
    y[i] = v / l[i * p + i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let v = y[i];
    for (let j = i + 1; j < p; j++) {
      v -= l[j * p + i] * a[j];
    }
    a[i] = v / l[i * p + i];
  }
  return a;
}
function design(s, p) {
  const b = new Float64Array(p),
    r = new Float64Array(p * p);
  for (let n = p; n < s.length; n++) {
    for (let i = 0; i < p; i++) {
      const x = s[n - i - 1];
      b[i] += x * s[n];
      for (let j = 0; j <= i; j++) {
        r[i * p + j] += x * s[n - j - 1];
      }
    }
  }
  if (!(r[0] > 1e-20)) {
    return null;
  }
  const l = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let value = r[i * p + j] + (i === j ? r[0] * 1e-13 : 0);
      for (let k = 0; k < j; k++) {
        value -= l[i * p + k] * l[j * p + k];
      }
      if (i === j && !(value > 0)) {
        return null;
      }
      l[i * p + j] = i === j ? Math.sqrt(value) : value / l[j * p + j];
    }
  }
  const ax = solve(l, b, p),
    res = new Float64Array(s.length);
  let ep = 0;
  for (let n = p; n < s.length; n++) {
    res[n] = s[n];
    for (let i = 0; i < p; i++) {
      res[n] -= ax[i] * s[n - i - 1];
    }
    ep += res[n] ** 2;
  }
  return { l, ax, res, ep };
}
export function refine(s, p, f0, rate, gci) {
  const system = design(s, p);
  if (!system) {
    return null;
  }
  const { l, ax, res, ep } = system;
  let best = { error: Infinity };
  function candidate(i, shift) {
    const { p: pulse, table } = templates()[i];
    const bm = new Float64Array(p);
    let mm = 0,
      rm = 0;
    for (let n = p; n < s.length; n++) {
      const phase = (((n - gci - shift) * f0) / rate + pulse.te + 100) % 1;
      const position = phase * 4096,
        lo = Math.floor(position);
      const m =
        table[lo] + (table[(lo + 1) % 4096] - table[lo]) * (position - lo);
      mm += m * m;
      rm += m * res[n];
      for (let j = 0; j < p; j++) {
        bm[j] += s[n - j - 1] * m;
      }
    }
    const am = solve(l, bm, p);
    let rr = mm;
    for (let j = 0; j < p; j++) {
      rr -= bm[j] * am[j];
    }
    const error = 1 - (rm * rm) / (rr * ep);
    if (rm > 0 && error >= 0 && error < best.error) {
      best = {
        error,
        rd: pulse.rd,
        shift,
        gain: rm / rr,
        i,
        a: am.map((v, j) => (rm / rr) * v - ax[j]),
      };
    }
  }
  for (
    let shift = -Math.round(rate * 0.0005);
    shift <= Math.round(rate * 0.0005);
    shift++
  ) {
    for (let i = 0; i < 38; i += 6) {
      candidate(i, shift);
    }
  }
  const seed = best;
  for (let i = Math.max(0, seed.i - 5); i <= Math.min(37, seed.i + 5); i++) {
    candidate(i, seed.shift);
  }
  return best.error < 0.5 ? best : null;
}
