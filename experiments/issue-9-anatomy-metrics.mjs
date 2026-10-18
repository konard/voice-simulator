// Model-vs-MRI metrics for every hosted Dresden Vocal Tract Dataset tract.
// Usage: node experiments/issue-9-anatomy-metrics.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  DVTD_VOWELS,
  compareWithDvtd,
  modelTract,
} from '../src/geometry/anatomy-compare.js';
import { tractAreaFunction } from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';
import { presetHeadConfig } from '../src/head-config.js';

const fixtures = new globalThis.URL('../tests/fixtures/dvtd/', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new globalThis.URL('manifest.json', fixtures))
);
for (const entry of manifest.files) {
  const [subject, , ...rest] = entry.file.split('-');
  const sound = rest.join('-').replace('-inner-surface.stl.gz', '');
  const head = presetHeadConfig(subject === 's1' ? 'male' : 'female');
  const tract = parseStl(
    gunzipSync(readFileSync(new globalThis.URL(entry.file, fixtures)))
  );
  const measured = tractAreaFunction(tract);
  const model = modelTract(head, DVTD_VOWELS[sound], {
    length: measured.length / 10,
  });
  const { metrics } = compareWithDvtd(model, tract, { measured });
  const outlines = Object.entries(metrics.outlineDistance)
    .map(([name, d]) => `${name} ${d === null ? '-' : d.toFixed(2)}`)
    .join(', ');
  console.log(
    `${entry.file}: length model ${metrics.modelLength.toFixed(2)} / MRI ${metrics.dvtdLength.toFixed(2)} cm, centreline RMS ${metrics.centrelineRms.toFixed(2)} cm, area log-RMS ${metrics.areaLogRms.toFixed(2)}\n  outline distance (cm): ${outlines}`
  );
}
