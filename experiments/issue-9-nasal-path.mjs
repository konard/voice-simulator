/**
 * Nasal path against the MRI-shaped tract: where it runs, how far it keeps
 * from the tract centreline away from the port, and its length.
 * Usage: node experiments/issue-9-nasal-path.mjs
 */
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import {
  headLandmarks,
  nasalCenterline,
  tractCenterline,
} from '../src/geometry/centerline.js';
import { normalizeHeadConfig, presetHeadConfig } from '../src/head-config.js';

for (const preset of ['male', 'female', 'child']) {
  const config = normalizeHeadConfig(presetHeadConfig(preset));
  const shape = tractShape({}, config);
  const tract = tractCenterline(config, {
    sections: 200,
    length: shape.length,
  });
  const nose = noseShape(config);
  const velumDistance =
    ((shape.velumIndex + 0.5) / shape.areas.length) * shape.length;
  const path = nasalCenterline(config, {
    sections: 24,
    velumDistance,
    length: nose.length,
  });
  const point = (p, i) => [
    p.points[i * 3],
    p.points[i * 3 + 1],
    p.points[i * 3 + 2],
  ];
  const rows = [];
  for (let i = 0; i < path.count; i += 3) {
    const q = point(path, i);
    let best = Infinity;
    for (let j = 0; j < tract.count; j++) {
      best = Math.min(
        best,
        Math.hypot(...point(tract, j).map((v, a) => v - q[a]))
      );
    }
    rows.push(
      `${q
        .slice(1)
        .map((v) => v.toFixed(2))
        .join(',')} d=${best.toFixed(2)}`
    );
  }
  console.log(
    preset,
    'nose',
    nose.length.toFixed(2),
    'path',
    path.length.toFixed(2),
    'nostrils',
    headLandmarks(config)
      .nostrils.slice(1)
      .map((v) => v.toFixed(2))
      .join(',')
  );
  console.log('  ', rows.join(' | '));
}
