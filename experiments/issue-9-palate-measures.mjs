// Midline measures (mm) of the hard palate and velum of the presets, next
// to the norms of tests/fixtures/anatomy/palate.json.
//
//   node experiments/issue-9-palate-measures.mjs
import { presetHeadConfig } from '../src/head-config.js';
import { palateMeasures } from '../tests/helpers/palate-measures.js';

for (const name of ['male', 'female', 'child']) {
  const measures = palateMeasures(presetHeadConfig(name));
  console.log(
    name,
    Object.fromEntries(
      Object.entries(measures).map(([key, value]) => [key, value.toFixed(1)])
    )
  );
}
