// Arch measures of Z-Anatomy teeth exported by scripts/blender/z_anatomy_export.py.
// Usage: node experiments/dental-za.mjs <stl directory>
import { readFileSync } from 'node:fs';
import {
  TOOTH_TYPES,
  archMeasures,
  toothLandmarks,
} from '../src/geometry/dental.js';
import { parseStl } from '../src/geometry/stl.js';

const names = [
  'medial_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar_tooth',
  'second_molar_tooth',
];
const teeth = [];
for (const jaw of ['upper', 'lower']) {
  for (const side of ['l', 'r']) {
    names.forEach((name, type) => {
      const file = `${process.argv[2]}/${jaw[0].toUpperCase()}${jaw.slice(1)}_${name}.${side}.stl`;
      teeth.push({
        jaw,
        side,
        type,
        positions: parseStl(new Uint8Array(readFileSync(file))).positions,
      });
    });
  }
}
const landmarks = toothLandmarks(teeth);
const m = archMeasures(landmarks);
for (const jaw of ['upper', 'lower']) {
  console.log(
    jaw,
    TOOTH_TYPES.map(
      (t, i) =>
        `${t}: ${m[jaw].widths[i].toFixed(1)}x${m[jaw].thicknesses[i].toFixed(1)}`
    ).join(', ')
  );
  console.log(
    jaw,
    'intercanine',
    m[jaw].intercanine.toFixed(1),
    'intermolar',
    m[jaw].intermolar.toFixed(1),
    'depth',
    m[jaw].depth.toFixed(1),
    'length',
    m[jaw].length.toFixed(1)
  );
}
console.log('overjet', m.overjet.toFixed(2), 'overbite', m.overbite.toFixed(2));
