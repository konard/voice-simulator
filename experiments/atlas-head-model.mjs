// The head model with its parts taken from the Z-Anatomy or BodyParts3D
// atlas downloaded by scripts/fetch-anatomy.mjs.
// Usage: node experiments/atlas-head-model.mjs z-anatomy|bodyparts3d DIR
import {
  registerAnatomySource,
  anatomySourceParts,
} from '../src/geometry/anatomy-sources.js';
import { headModel } from '../src/geometry/model.js';
import { presetHeadConfig } from '../src/head-config.js';
import { loadAtlasSource } from '../scripts/fetch-anatomy.mjs';

const [name, directory] = process.argv.slice(2);
registerAnatomySource(loadAtlasSource(name, directory));
console.log('parts', anatomySourceParts()[name]);
const meshes = headModel(presetHeadConfig('male'), { lod: 3, anatomy: name });
for (const mesh of meshes) {
  console.log(mesh.name, mesh.source ?? 'procedural', mesh.indices.length / 3);
}
