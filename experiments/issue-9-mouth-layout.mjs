// Landmarks of the MRI-template tract for the presets: where the incisors,
// the velopharyngeal port and the bend fall, and the rest section sizes.
// Usage: node experiments/issue-9-mouth-layout.mjs
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { incisorDepth } from '../src/articulation/teeth.js';
import {
  arcPoint,
  headLandmarks,
  tractCenterline,
} from '../src/geometry/centerline.js';
import { sectionAxes } from '../src/geometry/mesh.js';
import { presetHeadConfig } from '../src/head-config.js';

const fmt = (p) => p.map((v) => v.toFixed(2)).join(',');
for (const preset of ['male', 'female', 'child']) {
  const config = presetHeadConfig(preset);
  const rest = tractShape({}, config);
  const nose = noseShape(config);
  const { layout } = tractCenterline(config, { length: rest.length });
  const L = rest.length;
  const velum = ((rest.velumIndex + 0.5) / rest.areas.length) * L;
  console.log(
    preset,
    `L ${L.toFixed(2)} r ${config.pharynxRatio} velum ${velum.toFixed(2)} nose ${nose.length.toFixed(2)} maxNose ${Math.max(...nose.areas).toFixed(2)} lips ${fmt(headLandmarks(config).lips)} nostrils ${fmt(headLandmarks(config).nostrils)}`
  );
  for (let k = 0; k <= 20; k++) {
    const f = k / 20;
    const { point, tangent } = arcPoint(f * L, layout);
    const area =
      rest.areas[
        Math.min(rest.areas.length - 1, Math.round(f * (rest.areas.length - 1)))
      ];
    const [major, minor] = sectionAxes(area, f, config);
    const n = [0, tangent[2], -tangent[1]];
    const upper = point.map((v, a) => v + n[a] * minor);
    console.log(
      `  f ${f.toFixed(2)} d-lips ${(L - f * L).toFixed(2)} p ${fmt(point)} theta ${((Math.atan2(tangent[2], tangent[1]) * 180) / Math.PI).toFixed(0)} area ${area.toFixed(2)} axes ${major.toFixed(2)}/${minor.toFixed(2)} upper ${fmt(upper)}`
    );
  }
  console.log(
    '  incisorDepth',
    incisorDepth(config).toFixed(2),
    'teeth',
    JSON.stringify(rest.teeth)
  );
}
