// Lists the nodes, meshes, extensions and bounds of a binary glTF file,
// such as the HuBMAP HRA reference organs.
// Usage: node experiments/issue-9-hra-inspect.mjs <file.glb>
import { readFileSync } from 'node:fs';

const bytes = readFileSync(process.argv[2]);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const jsonLength = view.getUint32(12, true);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
console.log('asset', gltf.asset, 'extensionsUsed', gltf.extensionsUsed);
console.log(
  'nodes',
  gltf.nodes.length,
  'meshes',
  gltf.meshes.length,
  'scenes',
  gltf.scenes?.length
);
const vertices = (mesh) =>
  mesh.primitives.reduce(
    (sum, primitive) =>
      sum + gltf.accessors[primitive.attributes.POSITION].count,
    0
  );
for (const node of gltf.nodes) {
  const mesh = node.mesh === undefined ? null : gltf.meshes[node.mesh];
  const accessor =
    mesh && gltf.accessors[mesh.primitives[0].attributes.POSITION];
  console.log(
    JSON.stringify(node.name),
    mesh
      ? `vertices ${vertices(mesh)}`
      : `children ${node.children?.length ?? 0}`,
    node.matrix ? `matrix ${node.matrix.map((v) => +v.toFixed(4))}` : '',
    node.translation ? `t ${node.translation}` : '',
    node.rotation ? `r ${node.rotation}` : '',
    node.scale ? `s ${node.scale}` : '',
    accessor
      ? `min ${accessor.min?.map((v) => v.toFixed(4))} max ${accessor.max?.map((v) => v.toFixed(4))}`
      : ''
  );
}
