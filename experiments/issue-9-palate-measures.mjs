// Hard palate and velum measures of the presets (mm), as held to the
// published norms by tests/palate.test.js.
//
//   node experiments/issue-9-palate-measures.mjs
import { palateMeasures } from '../src/geometry/palate-measures.js';
import { presetHeadConfig } from '../src/head-config.js';

for (const name of ['male', 'female', 'child']) {
  const measures = palateMeasures(presetHeadConfig(name));
  console.log(
    name.padEnd(7),
    Object.entries(measures)
      .map(([key, value]) => `${key} ${value.toFixed(1)}`)
      .join('  ')
  );
}
