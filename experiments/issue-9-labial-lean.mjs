// Lean of the labial face of the central incisors over the crown (the
// most forward point of each 1 mm band from the incisal edge up the crown,
// fitted with a line), for the model and the HRA teeth fetched by
// `node scripts/fetch-anatomy.mjs hra DIR --sex male|female`.
// Usage: node experiments/issue-9-labial-lean.mjs [HRA_MALE_DIR HRA_FEMALE_DIR]
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { presetHeadConfig } from '../src/head-config.js';
import { loadDentition } from '../scripts/fetch-anatomy.mjs';

const CROWN = 9;
const MODE = process.env.MODE ?? 'labial';

function labialLean(positions, jaw) {
  const sign = jaw === 'upper' ? 1 : -1;
  let edge = Infinity;
  for (let index = 1; index < positions.length; index += 3) {
    edge = Math.min(edge, sign * positions[index]);
  }
  const front = new Map();
  for (let index = 0; index < positions.length; index += 3) {
    const rise = sign * positions[index + 1] - edge;
    if (rise >= 0.5 && rise <= CROWN) {
      const bin = Math.round(rise);
      const [low, high] = front.get(bin) ?? [Infinity, -Infinity];
      front.set(bin, [
        Math.min(low, positions[index + 2]),
        Math.max(high, positions[index + 2]),
      ]);
    }
  }
  const pairs = [...front].map(([rise, [low, high]]) => [
    sign * rise,
    MODE === 'labial' ? high : (low + high) / 2,
  ]);
  const my = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mz = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  const slope =
    pairs.reduce((s, p) => s + (p[0] - my) * (p[1] - mz), 0) /
    pairs.reduce((s, p) => s + (p[0] - my) ** 2, 0);
  return (Math.atan(slope) * 180) / Math.PI;
}

for (const preset of ['male', 'female']) {
  const parts = anatomyMeshes(presetHeadConfig(preset), { lod: 3 });
  const model = ['upper', 'lower'].map((jaw) => {
    const { positions } = parts.find((part) => part.name === `${jaw}Teeth`);
    const near = [];
    for (let index = 0; index < positions.length; index += 3) {
      if (Math.abs(positions[index]) < 0.3) {
        near.push(
          ...Array.from(positions.subarray(index, index + 3), (v) => v * 10)
        );
      }
    }
    return labialLean(near, jaw).toFixed(1);
  });
  console.log(preset, 'model', model);
}
process.argv.slice(2).forEach((directory) => {
  const teeth = loadDentition('hra', directory);
  const leans = ['upper', 'lower'].map((jaw) =>
    teeth
      .filter((tooth) => tooth.jaw === jaw && tooth.type === 0)
      .map((tooth) => labialLean(tooth.positions, jaw).toFixed(1))
  );
  console.log(directory, 'hra', JSON.stringify(leans));
});
