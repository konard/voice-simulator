// Resonances of the area functions extracted from Dresden Vocal Tract
// Dataset surfaces in the tube model, against the dataset's FEM transfer
// function peaks (vvtf-calculated.txt, c = 345 m/s).
// Usage: node experiments/issue-9-dvtd-tube-formants.mjs <inner-surface.stl>...
//   (the vvtf-calculated.txt is looked up next to each STL)
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tubeFormants, SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import {
  DVTD_SPEED_OF_SOUND,
  tractAreaFunction,
  vvtfPeaks,
} from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';

for (const file of process.argv.slice(2)) {
  const result = tractAreaFunction(parseStl(readFileSync(file)));
  const areas = result.areas.map((a) => a / 100);
  const length = (result.length / 10) * (SPEED_OF_SOUND / DVTD_SPEED_OF_SOUND);
  const tube = tubeFormants(areas, length, {
    count: 6,
    maxFrequency: 5000,
    step: 2,
  }).map(Math.round);
  const vvtf = file.replace('inner-surface.stl', 'vvtf-calculated.txt');
  const fem = existsSync(vvtf) ? vvtfPeaks(readFileSync(vvtf, 'utf8')) : [];
  console.log(
    `${basename(file)} (${(result.length / 10).toFixed(2)} cm)\n  tube ${tube.join(' ')}\n  FEM  ${fem.join(' ')}`
  );
}
