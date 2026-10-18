// Spectrum and extrema helpers for the issue 9 transfer experiments.
export function spectrum(response, rate, from = 100, to = 8000, step = 20) {
  const out = [];
  for (let f = from; f <= to; f += step) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / rate;
    for (let n = 0; n < response.length; n++) {
      re += response[n] * Math.cos(w * n);
      im -= response[n] * Math.sin(w * n);
    }
    out.push([f, 20 * Math.log10(Math.hypot(re, im) + 1e-12)]);
  }
  return out;
}

/** Peaks (sign 1) or dips (sign -1) with at least `prominence` dB on both sides. */
export function extrema(spec, sign, prominence = 6) {
  const result = [];
  const values = spec.map(([, v]) => v * sign);
  for (let i = 1; i < values.length - 1; i++) {
    if (!(values[i] > values[i - 1] && values[i] >= values[i + 1])) {
      continue;
    }
    let left = values[i];
    for (let j = i - 1; j >= 0 && values[j] <= values[i]; j--) {
      left = Math.min(left, values[j]);
    }
    let right = values[i];
    for (let j = i + 1; j < values.length && values[j] <= values[i]; j++) {
      right = Math.min(right, values[j]);
    }
    if (values[i] - Math.max(left, right) >= prominence) {
      result.push(spec[i][0]);
    }
  }
  return result;
}

/** RMS difference in dB between two spectra over [from, to] Hz, level-matched. */
export function distance(a, b, from = 200, to = 5000) {
  const diffs = [];
  a.forEach(([f, v], i) => {
    if (f >= from && f <= to) {
      diffs.push(v - b[i][1]);
    }
  });
  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  return Math.sqrt(
    diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / diffs.length
  );
}
