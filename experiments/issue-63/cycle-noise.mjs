// Unlicense. Experimental cycle-aligned, linearly detrended noise estimator.
function sample(x, at) {
  const i = Math.floor(at),
    u = at - i;
  const a = x[i - 1] ?? 0,
    b = x[i] ?? 0,
    c = x[i + 1] ?? 0,
    d = x[i + 2] ?? 0;
  return (
    b +
    0.5 *
      u *
      (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)))
  );
}
function measure(waves) {
  let noise = 0,
    signal = 0;
  for (let k = 0; k < waves[0].length; k++) {
    const centre = (waves[0][k] + waves[1][k] + waves[2][k]) / 3;
    const slope = (waves[2][k] - waves[0][k]) / 2;
    noise +=
      (waves[0][k] - centre + slope) ** 2 +
      (waves[1][k] - centre) ** 2 +
      (waves[2][k] - centre - slope) ** 2;
    signal += centre ** 2;
  }
  return 10 * Math.log10(Math.max(1e-8, (signal - noise / 3) / noise));
}
export function cycleNoise(frames, pitch) {
  const groups = [];
  const marks = pitch.marks;
  for (let first = 0; first + 3 < marks.length; first++) {
    const periods = Array.from(
      { length: 3 },
      (_, j) => marks[first + j + 1] - marks[first + j]
    );
    const mean = periods.reduce((a, b) => a + b, 0) / 3;
    if (periods.some((t) => Math.abs(t / mean - 1) > 0.08)) {
      continue;
    }
    const n = Math.min(128, Math.round(frames.rate * mean));
    const waves = periods.map((period, j) => {
      const wave = Float64Array.from({ length: n }, (_, k) =>
        sample(
          frames.samples,
          (marks[first + j] + (k / n) * period) * frames.rate
        )
      );
      const dc = wave.reduce((a, b) => a + b, 0) / n;
      const rms = Math.sqrt(wave.reduce((a, b) => a + (b - dc) ** 2, 0) / n);
      return wave.map((v) => (v - dc) / Math.max(1e-12, rms));
    });
    groups.push({
      time: (marks[first] + marks[first + 3]) / 2,
      span: 1.5 * mean,
      hnr: measure(waves),
    });
  }
  let index = 0;
  return Float32Array.from({ length: frames.count }, (_, t) => {
    const time = t * frames.hop;
    while (
      index + 1 < groups.length &&
      Math.abs(groups[index + 1].time - time) <
        Math.abs(groups[index].time - time)
    ) {
      index++;
    }
    const group = groups[index];
    return group && Math.abs(group.time - time) <= group.span ? group.hnr : NaN;
  });
}
