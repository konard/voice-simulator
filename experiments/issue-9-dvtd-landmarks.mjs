// Landmarks of Dresden Vocal Tract Dataset inner surfaces: extent, the
// open glottis and lip cuts (boundary loops), their sizes and the vector
// between them.
// Usage: node experiments/issue-9-dvtd-landmarks.mjs <stl>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStl } from '../src/geometry/stl.js';
import { boundaryLoops, loopShape, meshBounds } from '../src/geometry/slice.js';

const f = (values) => values.map((value) => value.toFixed(1)).join(' ');
for (const file of process.argv.slice(2)) {
  const mesh = parseStl(readFileSync(file));
  const { min, max } = meshBounds(mesh);
  console.log(
    `${basename(file)}: ${mesh.indices.length / 3} triangles, bbox [${f(min)}] .. [${f(max)}]`
  );
  const loops = boundaryLoops(mesh)
    .filter((loop) => loop.length > 8)
    .map((loop) => loopShape(mesh, loop));
  for (const loop of loops) {
    const xs = loop.points.map((p) => p[0]);
    const ys = loop.points.map((p) => p[1]);
    const zs = loop.points.map((p) => p[2]);
    const span = (v) => (Math.max(...v) - Math.min(...v)).toFixed(1);
    console.log(
      `  loop ${loop.points.length} pts centre [${f(loop.center)}] normal [${f(loop.normal)}] area ${(loop.area / 100).toFixed(2)} cm² span x ${span(xs)} y ${span(ys)} z ${span(zs)} mm`
    );
  }
}
