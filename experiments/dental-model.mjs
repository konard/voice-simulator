// Arch measures of the procedural teeth for each head preset.
// Usage: node experiments/dental-model.mjs
import { dentalLandmarks } from '../src/geometry/anatomy.js';
import { archMeasures } from '../src/geometry/dental.js';
import { presetHeadConfig } from '../src/head-config.js';

const f = (v) => (v === null ? '-' : v.toFixed(1));
for (const preset of ['male', 'female', 'child']) {
  const m = archMeasures(dentalLandmarks(presetHeadConfig(preset)));
  console.log(`== ${preset}`);
  for (const jaw of ['upper', 'lower']) {
    console.log(
      jaw,
      'w',
      m[jaw].widths.map(f).join(' '),
      '| t',
      m[jaw].thicknesses.map(f).join(' ')
    );
    console.log(
      jaw,
      'ic',
      f(m[jaw].intercanine),
      'im',
      f(m[jaw].intermolar),
      'depth',
      f(m[jaw].depth),
      'len',
      f(m[jaw].length)
    );
  }
  console.log('overjet', f(m.overjet), 'overbite', f(m.overbite));
}
