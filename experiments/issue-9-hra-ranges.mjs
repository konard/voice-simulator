// Bytes of a GLB that the HRA roles need (range requests fetch only these).
// Usage: node experiments/issue-9-hra-ranges.mjs <file.glb>
import { readFileSync } from 'node:fs';
import {
  accessorRange,
  glbJson,
  meshAccessors,
} from '../src/geometry/gltf-read.js';
import { HRA_PARTS } from '../src/geometry/reference-anatomy.js';

const bytes = new Uint8Array(readFileSync(process.argv[2]));
const { json } = glbJson(bytes);
const wanted = (name) => Object.values(HRA_PARTS).some((test) => test(name));
const accessors = meshAccessors(json, { names: wanted });
const total = accessors.reduce((sum, index) => {
  const { start, end } = accessorRange(json, index);
  return sum + end - start;
}, 0);
console.log(
  `${accessors.length} accessors, ${(total / 1e6).toFixed(1)} MB of ${(bytes.length / 1e6).toFixed(1)} MB`
);
