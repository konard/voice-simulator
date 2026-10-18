// Arch measures of every anatomy source fetched by scripts/fetch-anatomy.mjs.
// Usage: node experiments/dental-reference.mjs <source> <directory>
import { archMeasures, toothLandmarks } from '../src/geometry/dental.js';
import { loadDentition } from '../scripts/fetch-anatomy.mjs';

const [source, directory] = process.argv.slice(2);
const m = archMeasures(toothLandmarks(loadDentition(source, directory)));
const f = (v) => (v === null ? '-' : v.toFixed(1));
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
