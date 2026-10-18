// The model's key points per preset, to compare measurement changes.
import { modelKeyPoints } from '../src/geometry/reference-anatomy.js';
import { presetHeadConfig } from '../src/head-config.js';
for (const preset of ['male', 'female', 'child']) {
  const points = modelKeyPoints(presetHeadConfig(preset));
  console.log(
    preset,
    Object.entries(points)
      .map(([k, v]) => `${k} ${v.map((x) => x.toFixed(2)).join(',')}`)
      .join(' | ')
  );
}
