/**
 * Issue 36: tube formants of the Dresden Vocal Tract Dataset fixtures
 * (tests/geometry-analysis.test.js) against their FEM resonances, with
 * and without the yielding walls and the constriction loss.
 *
 * Run: node experiments/issue-36-dvtd.mjs
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseStl } from '../src/geometry/stl.js';
import {
  DVTD_SPEED_OF_SOUND,
  tractAreaFunction,
} from '../src/geometry/dvtd.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';

const FIXTURES = new URL('../tests/fixtures/dvtd/', import.meta.url);
const MANIFEST = JSON.parse(
  readFileSync(new URL('manifest.json', FIXTURES), 'utf8')
);

for (const entry of MANIFEST.files) {
  const result = tractAreaFunction(
    parseStl(gunzipSync(readFileSync(new URL(entry.file, FIXTURES))))
  );
  const length = (result.length / 10) * (SPEED_OF_SOUND / DVTD_SPEED_OF_SOUND);
  const areas = result.areas.map((area) => area / 100);
  const row = (options) =>
    tubeFormants(areas, length, {
      count: 3,
      maxFrequency: 5000,
      step: 2,
      ...options,
    })
      .map((value, index) => {
        const fem = entry.femResonances[index];
        return `${value.toFixed(0)} (${((100 * (value - fem)) / fem).toFixed(1)} %)`;
      })
      .join(' ');
  console.log(entry.file, 'FEM', entry.femResonances.join(' '));
  console.log('  default          ', row({}));
  console.log('  rigid walls      ', row({ walls: false }));
  console.log('  no constriction  ', row({ constriction: false }));
  console.log('  rigid, 2e-5 loss ', row({ walls: false, loss: 2e-5, constriction: false }));
}
