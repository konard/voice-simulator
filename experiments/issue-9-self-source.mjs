/**
 * The procedural model taken as an anatomy source of itself: composing it
 * back into the same head should give the procedural parts again.
 */
import * as S from '../src/geometry/anatomy-sources.js';
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { modelKeyPoints } from '../src/geometry/reference-anatomy.js';
import { presetHeadConfig } from '../src/head-config.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { REST_GAP } from '../src/articulation/teeth.js';

const head = presetHeadConfig('male');
// Scans are taken with the jaw closed: the lower teeth at REST_GAP.
const rest = tractShape({}, head);
const closed = { ...rest, teeth: { ...rest.teeth, gap: REST_GAP } };
const meshes = anatomyMeshes(head, { lod: 3, shape: closed }).map((part) => ({
  name: part.name,
  positions: Float64Array.from(part.positions, (v) => v * 10),
  indices: part.indices,
}));
const roles = Object.fromEntries(
  S.ANATOMY_PARTS.map((part) => [part, (name) => name === part])
);
const source = S.anatomySource('self', meshes, {
  roles,
  keyPoints: modelKeyPoints(head),
});
console.log('archWidth', source.archWidth);
for (const state of [{}, { jaw: 1 }]) {
  const composed = S.composeAnatomy(head, { anatomy: source, lod: 3, state });
  const procedural = anatomyMeshes(head, { lod: 3, state });
  composed.forEach((part, index) => {
    const other = procedural[index].positions;
    let worst = 0;
    part.positions.forEach((v, i) => {
      worst = Math.max(worst, Math.abs(v - other[i]));
    });
    console.log(
      JSON.stringify(state),
      part.name,
      part.source,
      worst.toExponential(2)
    );
  });
}
