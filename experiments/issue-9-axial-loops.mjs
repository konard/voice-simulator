// Outline loops of the model tract and an MRI tract in one comparison
// plane: where each loop lies and how far it is from the other outline.
// Usage: node experiments/issue-9-axial-loops.mjs [tract] [preset] [sound] [plane]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  DVTD_VOWELS,
  compareWithDvtd,
  modelTract,
  outline,
} from '../src/geometry/anatomy-compare.js';
import { parseStl } from '../src/geometry/stl.js';
import { presetHeadConfig } from '../src/head-config.js';

const [
  name = 's2-01-bahn-tense-a',
  preset = 'female',
  sound = 'bahn-tense-a',
  planeName = 'axial 30%',
] = process.argv.slice(2);
const tract = parseStl(
  gunzipSync(readFileSync(`tests/fixtures/dvtd/${name}-inner-surface.stl.gz`))
);
const model = modelTract(presetHeadConfig(preset), DVTD_VOWELS[sound]);
const result = compareWithDvtd(model, tract);
const plane = result.planes.find((entry) => entry.name === planeName);
console.log(
  planeName,
  'distance',
  plane.distance.toFixed(2),
  'point',
  plane.point.map((v) => v.toFixed(2)).join(' ')
);
const describe = (label, loops) =>
  loops.forEach((loop, index) => {
    const xs = loop.map((p) => p[0]);
    const zs = loop.map((p) => p[2]);
    console.log(
      label,
      index,
      'points',
      loop.length,
      'x',
      Math.min(...xs).toFixed(2),
      Math.max(...xs).toFixed(2),
      'z',
      Math.min(...zs).toFixed(2),
      Math.max(...zs).toFixed(2)
    );
  });
describe(
  'model',
  outline(
    model.meshes.find((m) => m.name === 'tract'),
    plane
  )
);
describe('mri', outline(result.dvtd.meshes[0], plane));
