// Build head/tract meshes for each LOD and write an OBJ for inspection.
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  headMesh,
  tubeMesh,
  lipsMesh,
  meshesToObj,
  headField,
  MESH_LODS,
} from '../src/geometry/mesh.js';
import {
  tractCenterline,
  nasalCenterline,
  headLandmarks,
} from '../src/geometry/centerline.js';
import { tractShape, noseShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const head = DEFAULT_HEAD;
const field = headField(head);
const { lips } = headLandmarks(head);
console.log(
  'field at lips',
  field(lips).toFixed(2),
  'centre',
  field([0, 0, 0]).toFixed(2)
);
for (let lod = 0; lod < MESH_LODS.length; lod++) {
  const start = performance.now();
  const mesh = headMesh(head, { lod });
  console.log(
    'lod',
    lod,
    'vertices',
    mesh.positions.length / 3,
    'triangles',
    mesh.indices.length / 3,
    `${(performance.now() - start).toFixed(1)} ms`
  );
}
const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme('ɑ') }) },
  head
);
const path = tractCenterline(head, { sections: 44, length: shape.length });
const nose = noseShape(head);
const nosePath = nasalCenterline(head, {
  velumDistance: 7,
  length: nose.length,
});
mkdirSync('experiments/out', { recursive: true });
writeFileSync(
  'experiments/out/head.obj',
  meshesToObj([
    { name: 'head', ...headMesh(head, { lod: 2 }) },
    { name: 'tract', ...tubeMesh(path, shape.areas, { head }) },
    {
      name: 'nose',
      ...tubeMesh(nosePath, nose.areas, {
        head,
        axes: (a) => [Math.sqrt(a / Math.PI), Math.sqrt(a / Math.PI)],
      }),
    },
    { name: 'lips', ...lipsMesh(head, { area: shape.areas.at(-1) }) },
  ])
);
console.log('wrote experiments/out/head.obj');
