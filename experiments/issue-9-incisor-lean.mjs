// Sagittal lean of the model's central incisors (the vertices of each
// arch within a few millimetres of the midline) against the HRA fixture.
import { readFileSync } from 'node:fs';
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { sagittalLean } from '../src/geometry/reference-anatomy.js';
import { presetHeadConfig } from '../src/head-config.js';

const fixture = JSON.parse(
  readFileSync(
    new globalThis.URL('../tests/fixtures/anatomy/hra.json', import.meta.url)
  )
);
for (const preset of ['male', 'female', 'child']) {
  const parts = anatomyMeshes(presetHeadConfig(preset), { lod: 3 });
  const leans = {};
  for (const band of [0.2, 0.3, 0.4]) {
    leans[band] = ['upperTeeth', 'lowerTeeth'].map((name) => {
      const { positions } = parts.find((part) => part.name === name);
      const near = [];
      for (let index = 0; index < positions.length; index += 3) {
        if (Math.abs(positions[index]) < band) {
          near.push(...positions.subarray(index, index + 3));
        }
      }
      return sagittalLean(near).toFixed(1);
    });
  }
  console.log(
    preset,
    JSON.stringify(leans),
    JSON.stringify(fixture.incisorLean[preset] ?? null)
  );
}
