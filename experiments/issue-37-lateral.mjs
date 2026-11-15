// Depths of the sheet around the tongue constriction of [l]:
// node experiments/issue-37-lateral.mjs
import { buildSheet, updateSheet } from '../src/acoustics/sheet-model.js';
import { consonantTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const shape = tractShape(
  consonantTarget({ phoneme: getPhoneme('l') }),
  DEFAULT_HEAD
);
console.log(
  'lateral',
  shape.lateral,
  'frication index',
  shape.frication.index,
  'sections',
  shape.areas.length
);
const sheet = updateSheet(buildSheet(DEFAULT_HEAD), shape);
console.log('lateral columns', sheet.lateralColumns);
for (const column of sheet.lateralColumns) {
  const row = Array.from(
    sheet.h.subarray(column * sheet.rows, (column + 1) * sheet.rows)
  );
  const sum = row.reduce((a, b) => a + b, 0) * sheet.dx;
  console.log(
    column,
    row.map((h) => h.toFixed(3)).join(' '),
    'area',
    sum.toFixed(4),
    sheet.areas[column].toFixed(4)
  );
}
console.log(
  'min area',
  Math.min(...shape.areas).toFixed(3),
  'at',
  shape.areas.indexOf(Math.min(...shape.areas))
);
