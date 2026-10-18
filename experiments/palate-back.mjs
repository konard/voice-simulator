// Back end of the procedural palate on cuts beside the midline.
import { palateMesh } from '../src/geometry/anatomy.js';
import { densify } from '../src/geometry/align.js';
import { axisPlane, sliceMesh } from '../src/geometry/slice.js';
import { presetHeadConfig } from '../src/head-config.js';
const m = palateMesh(presetHeadConfig('male'), { lod: 3 });
const mm = {
  positions: Float64Array.from(m.positions, (v) => v * 10),
  indices: m.indices,
};
for (const x of [-0.05, 0.75, 1.5, 3, 6]) {
  const pts = densify(sliceMesh(mm, axisPlane(0, x)), 0.25);
  const back = Math.min(...pts.map((p) => p[2]));
  const band = pts.filter((p) => p[2] <= back + 1.5);
  const low = band.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(
    x,
    'back z',
    back.toFixed(2),
    'lowest',
    low.map((v) => v.toFixed(2)).join(' ')
  );
}
