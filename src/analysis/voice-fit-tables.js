/**
 * Inverses of the default-head calibration tables of stage A. Unlicense,
 * issue 63.
 */
import { BREATHINESS_CPP, TENSENESS_RD } from './voice-fit-calibration.js';

/** Parameter value at which a measured calibration [[parameter, measure]] reads `value`. */
export function tableInverse(value, table) {
  let best = { residual: Infinity, value: 0 };
  for (let i = 1; i < table.length; i++) {
    const [a, x] = table[i - 1],
      [b, y] = table[i];
    const t = Math.max(0, Math.min(1, (value - x) / (y - x)));
    const residual = Math.abs(value - (x + (y - x) * t));
    if (residual < best.residual) {
      best = { residual, value: a + (b - a) * t };
    }
  }
  return best.value;
}

/**
 * Rows of `table[key]` (one per table.pitch) interpolated in log pitch at
 * `f0`, clamped to the table. A missing (0) entry takes its neighbour's.
 */
function atPitch(table, key, f0) {
  const x = Math.log(
    Math.max(table.pitch[0], Math.min(table.pitch.at(-1), f0))
  );
  let i = 1;
  while (i < table.pitch.length - 1 && x > Math.log(table.pitch[i])) {
    i++;
  }
  const t =
    (x - Math.log(table.pitch[i - 1])) /
    (Math.log(table.pitch[i]) - Math.log(table.pitch[i - 1]));
  const mix = (a, b) =>
    Array.isArray(a)
      ? a.map((v, k) => mix(v, b[k]))
      : !a || !b
        ? a || b
        : a + (b - a) * t;
  return mix(table[key][i - 1], table[key][i]);
}

/**
 * Breathiness from the median CPP at the median pitch: the default-head
 * CPP row at that pitch (interpolated in log pitch, clamped to the table)
 * is inverted. Returns the value and the CPP change per unit breathiness.
 */
export function cppBreathiness(cpp, f0, table = BREATHINESS_CPP) {
  const row = atPitch(table, 'cpp', f0).map((c, k) => [
    table.breathiness[k],
    c,
  ]);
  const value = tableInverse(cpp, row);
  const k = Math.max(
    1,
    Math.min(row.length - 1, Math.ceil(value / table.breathiness[1]))
  );
  const slope = Math.abs(
    (row[k][1] - row[k - 1][1]) / (row[k][0] - row[k - 1][0])
  );
  return { value, slope };
}

/**
 * Tenseness from the median inverse-filter rd at the measured pitch and
 * breathiness. The default-head rd is interpolated in log pitch and in
 * breathiness, then read on a grid of tenseness: rd saturates (at high
 * pitch above about 0.85), so every tenseness whose reading is within half
 * a histogram bin of the closest one counts, and the value is their mean.
 * `spread` is half the width of that set; `slope` the rd change per unit
 * tenseness around the value.
 */
export function rdTenseness(rd, f0, breathiness, table = TENSENESS_RD) {
  const rows = atPitch(table, 'rd', f0),
    b = table.breathiness,
    y = Math.max(b[0], Math.min(b.at(-1), breathiness));
  let j = 1;
  while (j < b.length - 1 && y > b[j]) {
    j++;
  }
  const u = (y - b[j - 1]) / (b[j] - b[j - 1]);
  const ts = table.tenseness,
    row = rows[j - 1].map((v, k) => v + (rows[j][k] - v) * u);
  const reading = (t) => {
    let k = 1;
    while (k < ts.length - 1 && t > ts[k]) {
      k++;
    }
    return (
      row[k - 1] +
      ((row[k] - row[k - 1]) * (t - ts[k - 1])) / (ts[k] - ts[k - 1])
    );
  };
  const grid = [];
  for (let t = ts[0]; t <= ts.at(-1) + 1e-9; t += 0.005) {
    grid.push([t, Math.abs(reading(t) - rd)]);
  }
  const least = Math.min(...grid.map((g) => g[1]));
  const near = grid
    .filter((g) => g[1] <= least + table.bin / 2)
    .map((g) => g[0]);
  const value = near.reduce((s, t) => s + t, 0) / near.length;
  const lo = Math.max(ts[0], value - 0.05),
    hi = Math.min(ts.at(-1), value + 0.05);
  return {
    value,
    spread: (near.at(-1) - near[0]) / 2,
    slope: Math.abs(reading(hi) - reading(lo)) / Math.max(hi - lo, 1e-9),
  };
}
