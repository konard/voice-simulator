// Fit a beta-function dental arch (Braun et al. 1998) to the Open-Full-Jaw
// population means: crowns are laid along the curve by their widths, then
// intercanine width, intermolar width and depth are compared.
// Usage: node experiments/arch-form-fit.mjs
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(
    new globalThis.URL(
      '../tests/fixtures/anatomy/dentition.json',
      import.meta.url
    )
  )
);
const stats = fixture.sources['open-full-jaw'].statistics;

function curve(width, depth, power, steps = 2000) {
  const points = [];
  let length = 0;
  for (let step = 0; step <= steps; step++) {
    const x = ((step / steps) * width) / 2;
    const u = x / width;
    const z = depth - 4 ** power * depth * ((0.5 + u) * (0.5 - u)) ** power;
    if (step) {
      length += Math.hypot(x - points.at(-1)[0], z - points.at(-1)[1]);
    }
    points.push([x, z, length]);
  }
  return points;
}
function at(points, s) {
  return points.find((p) => p[2] >= s) ?? points.at(-1);
}
function fit(jaw, width, power) {
  const widths = stats[jaw].widths.map((w) => w.mean);
  const total = widths.reduce((a, b) => a + b);
  let lo = 0,
    hi = 200;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (curve(width, mid, power).at(-1)[2] < total) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const pts = curve(width, lo, power);
  const mids = [];
  let s = 0;
  for (const w of widths) {
    mids.push(at(pts, s + w / 2));
    s += w;
  }
  return {
    depth: lo,
    ic: 2 * mids[2][0],
    im: 2 * mids[5][0],
    d: mids[5][1] - mids[0][1] - 0,
    inc: mids[0],
  };
}
for (const jaw of ['upper', 'lower']) {
  const t = stats[jaw];
  let best = null;
  for (let width = 40; width <= 70; width += 0.25) {
    for (let power = 0.1; power <= 2.0; power += 0.02) {
      const r = fit(jaw, width, power);
      const depthToMolars = r.d;
      const err =
        ((r.ic - t.intercanine.mean) / t.intercanine.sd) ** 2 +
        ((r.im - t.intermolar.mean) / t.intermolar.sd) ** 2 +
        ((depthToMolars - t.depth.mean) / t.depth.sd) ** 2;
      if (!best || err < best.err) {
        best = { err, width, power, ...r, depthToMolars };
      }
    }
  }
  console.log(
    jaw,
    JSON.stringify(best, (k, v) =>
      typeof v === 'number' ? Math.round(v * 100) / 100 : v
    )
  );
  console.log(
    jaw,
    'target ic',
    t.intercanine.mean,
    'im',
    t.intermolar.mean,
    'depth',
    t.depth.mean
  );
}
