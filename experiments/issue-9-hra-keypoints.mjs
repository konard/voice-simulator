// Key points of the HuBMAP reference mouth and larynx against the model.
// Usage: node experiments/issue-9-hra-keypoints.mjs <mouth.glb> <larynx.glb> <preset>
import { readFileSync } from 'node:fs';
import { readGlbMeshes } from '../src/geometry/gltf-read.js';
import {
  compareKeyPoints,
  mirrorX,
  modelKeyPoints,
  referenceKeyPoints,
  referenceParts,
} from '../src/geometry/reference-anatomy.js';
import { presetHeadConfig } from '../src/head-config.js';

const [mouthFile, larynxFile, preset = 'male'] = process.argv.slice(2);
const load = (file) =>
  readGlbMeshes(new Uint8Array(readFileSync(file)), { scale: 1000 });
const meshes = mirrorX([...load(mouthFile), ...load(larynxFile)]);
const reference = referenceKeyPoints(referenceParts(meshes));
const model = modelKeyPoints(presetHeadConfig(preset));
const format = (point) => point.map((value) => value.toFixed(1)).join(', ');
console.log('midline', reference.midline.toFixed(2));
const fit = process.argv[5]?.split(',');
const { distances, rms, transform } = compareKeyPoints(model, reference, {
  fit,
});
for (const name of Object.keys(distances)) {
  console.log(
    name.padEnd(17),
    format(reference[name]).padEnd(24),
    format(model[name]).padEnd(24),
    distances[name].toFixed(1)
  );
}
console.log(
  'rms',
  rms.toFixed(2),
  'rotation',
  transform.rotation
    .flat()
    .map((v) => v.toFixed(3))
    .join(' ')
);
